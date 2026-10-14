(function () {
  const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "LI", "PRE", "HR"]);
  const HR_PATTERN = /^(-{3,}|\*{3,}|_{3,})\s*$/;
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  const TextUtils = Internals.TextUtils;
  const TableCodec = Internals.TableCodec;
  if (!TextUtils) {
    throw new Error("AmoristTextUtils must be loaded before AmoristMarkdownCodec.");
  }
  if (!TableCodec) {
    throw new Error("AmoristTableCodec must be loaded before AmoristMarkdownCodec.");
  }

  function renderMarkdown(markdown, references = null, clipboard = false) {
    const blocks = parseBlocks(markdown);
    if (blocks.length === 0) return "<p><br></p>";
    return blocks.map(block=>renderBlock(block,references,clipboard)).join("");
  }

  function parseBlocks(markdown) {
    const lines = TextUtils.normalize(markdown).split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const sourceLine = index;

      const fence = line.match(/^ {0,3}(`{3,}|~{3,}).*$/);
      if (fence) {
        const fenceMarker = fence[1][0];
        const fenceLength = fence[1].length;
        const closingFence = new RegExp(`^ {0,3}\\${fenceMarker}{${fenceLength},}\\s*$`);
        const code = [];
        index += 1;
        while (index < lines.length && !closingFence.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push({ type: "code", text: code.join("\n"), sourceLine });
        continue;
      }

      if (TableCodec.isTableStart(lines, index)) {
        const tableLines = [lines[index], lines[index + 1]];
        const tableColumnCount = TableCodec.splitTableRow(lines[index + 1]).length;
        index += 2;
        while (index < lines.length) {
          if (TableCodec.looksLikeTableRow(lines[index], tableColumnCount)) {
            tableLines.push(lines[index]);
            index += 1;
            continue;
          }

          if (!lines[index].trim()) {
            const nextTableRow = TableCodec.nextNonEmptyTableRow(lines, index + 1, tableColumnCount);
            if (nextTableRow > index) {
              index = nextTableRow;
              continue;
            }
          }

          break;
        }
        blocks.push({ type: "table", text: TableCodec.formatMarkdownTable(tableLines.join("\n")), sourceLine });
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        blocks.push({ type: "heading", level: heading[1].length, text: heading[2], sourceLine });
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        blocks.push({ type: "quote", text: joinTextLines(quote), sourceLine });
        continue;
      }

      if (matchListItem(line)) {
        const list = parseList(lines, index);
        blocks.push(list.block);
        index = list.nextIndex;
        continue;
      }

      if (HR_PATTERN.test(line)) {
        blocks.push({ type: "hr", sourceLine });
        index += 1;
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !isBlockStart(lines, index)
      ) {
        paragraph.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "paragraph", text: joinTextLines(paragraph), sourceLine });
    }

    return blocks;
  }

  // Joins the lines of one block. A newline between them is a soft break, i.e. a
  // space — that is what lets prose be wrapped in the source without the wrap
  // reaching the reader. Only an explicit CommonMark marker (two trailing spaces
  // or a trailing backslash) is a hard break, carried as "\n" in the block text
  // and rendered as <br>.
  function joinTextLines(lines) {
    const parts = lines.map(splitHardBreak);
    return parts.reduce((text, part, index) => (
      index === 0 ? part.text : text + (parts[index - 1].hardBreak ? "\n" : " ") + part.text
    ), "");
  }

  function splitHardBreak(line) {
    const backslash = line.match(/^(.*)\\$/);
    if (backslash) return { text: backslash[1], hardBreak: true };
    const spaces = line.match(/^(.*\S) {2,}$/);
    if (spaces) return { text: spaces[1], hardBreak: true };
    return { text: line, hardBreak: false };
  }

  // A list line: leading indent, a marker, and the item's own text. The indent
  // is what makes nesting work — it is the only thing distinguishing a sublist
  // from a sibling item, so it must be captured rather than anchored away.
  function matchListItem(line) {
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!match) return null;
    const bullet = match[2] !== "" && !/\d/.test(match[2]);
    const task = bullet ? match[3].match(/^\[([ xX])\]\s+(.*)$/) : null;
    return {
      indent: match[1].length,
      type: task ? "taskList" : (bullet ? "bulletList" : "orderedList"),
      checked: Boolean(task) && task[1].toLowerCase() === "x",
      text: task ? task[2] : match[3],
    };
  }

  // Consumes one list, recursing into sublists. Items are collected while the
  // marker stays at the list's own indent; anything deeper becomes a child of
  // the item above it, anything shallower (or a different marker type) ends the
  // list and is left for the caller.
  function parseList(lines, start) {
    const first = matchListItem(lines[start]);
    const listIndent = first.indent;
    const block = { type: first.type, items: [], sourceLine: start };
    let index = start;

    while (index < lines.length) {
      let probe = index;
      while (probe < lines.length && !lines[probe].trim()) probe += 1;
      if (probe >= lines.length) break;

      const item = matchListItem(lines[probe]);
      if (!item || item.indent < listIndent) break;

      if (item.indent > listIndent) {
        if (block.items.length === 0) break;
        const nested = parseList(lines, probe);
        block.items[block.items.length - 1].children.push(nested.block);
        index = nested.nextIndex;
        continue;
      }

      if (item.type !== block.type) break;
      block.items.push(makeListItem(block.type, item));
      index = probe + 1;
    }

    return { block, nextIndex: index };
  }

  function makeListItem(type, item) {
    return type === "taskList"
      ? { checked: item.checked, text: item.text, children: [] }
      : { text: item.text, children: [] };
  }

  function isBlockStart(lines, index) {
    const line = Array.isArray(lines) ? lines[index] : lines;
    return /^(#{1,6})\s+/.test(line) ||
      /^ {0,3}(`{3,}|~{3,})/.test(line) ||
      /^>\s?/.test(line) ||
      Boolean(matchListItem(line)) ||
      HR_PATTERN.test(line) ||
      (Array.isArray(lines) && TableCodec.isTableStart(lines, index));
  }

  function renderBlock(block, references = null, clipboard = false) {
    const attrs = sourceLineAttr(block);
    switch (block.type) {
      case "heading":
        return `<h${block.level}${attrs}>${renderInline(block.text,references)}</h${block.level}>`;
      case "quote":
        return `<blockquote${attrs}>${renderInline(block.text,references)}</blockquote>`;
      case "hr":
        return `<hr${attrs}>`;
      case "code":
        return `<pre${attrs}><code>${TextUtils.escapeHtml(block.text)}</code></pre>`;
      case "table":
        if(clipboard) {
          const cells=line=> {
            const raw=line.trim(), delimiters=TableCodec.tableDelimiters(raw), result=[];
            let start=0;
            for(const at of delimiters) {if(at!==0) result.push(raw.slice(start,at).trim());start=at+1;}
            if(start<raw.length || !delimiters.length) result.push(raw.slice(start).trim());
            return result;
          };
          const rows=block.text.split("\n");
          const html=(row,tag)=>"<tr>"+cells(row).map(text=>`<${tag}>${renderInline(text,references)}</${tag}>`).join("")+"</tr>";
          return "<table><thead>"+html(rows[0],"th")+"</thead><tbody>"+rows.slice(2).map(row=>html(row,"td")).join("")+"</tbody></table>";
        }
        return `<pre class="amorist-markdown-table" data-block-type="table"${attrs}><code>${TextUtils.escapeHtml(block.text)}</code></pre>`;
      case "taskList":
        return `<ul class="amorist-task-list"${attrs}>${block.items.map((item) =>
          `<li class="amorist-task-item" data-checked="${item.checked}"><span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content">${renderInline(item.text,references)}</span>${renderSublists(item,references,clipboard)}</li>`,
        ).join("")}</ul>`;
      case "bulletList":
        return `<ul${attrs}>${block.items.map(item=>renderListItem(item,references,clipboard)).join("")}</ul>`;
      case "orderedList":
        return `<ol${attrs}>${block.items.map(item=>renderListItem(item,references,clipboard)).join("")}</ol>`;
      default:
        return `<p${attrs}>${renderInline(block.text,references)}</p>`;
    }
  }

  function renderListItem(item, references = null, clipboard = false) {
    return `<li>${renderInline(item.text,references)}${renderSublists(item,references,clipboard)}</li>`;
  }

  function renderSublists(item,references = null, clipboard = false) {
    return (item.children || []).map(block=>renderBlock(block,references,clipboard)).join("");
  }

  function sourceLineAttr(block) {
    return ` data-source-line="${Number(block.sourceLine || 0)}"`;
  }

  function safeLinkHref(value) {
    const href = String(value);
    const scheme = href.replace(/[\u0000-\u0020\u007f]/g, "").match(/^([a-z][a-z0-9+.-]*):/i);
    return !scheme || /^(?:https?|mailto)$/i.test(scheme[1]) ? href : null;
  }

  const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/;
  // BEGIN generated HTML character references
  const HTML_CHARACTER_REFERENCES = {"AElig":"\u00c6","AMP":"&","Aacute":"\u00c1","Abreve":"\u0102","Acirc":"\u00c2","Acy":"\u0410","Afr":"\ud835\udd04","Agrave":"\u00c0","Alpha":"\u0391","Amacr":"\u0100","And":"\u2a53","Aogon":"\u0104","Aopf":"\ud835\udd38","ApplyFunction":"\u2061","Aring":"\u00c5","Ascr":"\ud835\udc9c","Assign":"\u2254","Atilde":"\u00c3","Auml":"\u00c4","Backslash":"\u2216","Barv":"\u2ae7","Barwed":"\u2306","Bcy":"\u0411","Because":"\u2235","Bernoullis":"\u212c","Beta":"\u0392","Bfr":"\ud835\udd05","Bopf":"\ud835\udd39","Breve":"\u02d8","Bscr":"\u212c","Bumpeq":"\u224e","CHcy":"\u0427","COPY":"\u00a9","Cacute":"\u0106","Cap":"\u22d2","CapitalDifferentialD":"\u2145","Cayleys":"\u212d","Ccaron":"\u010c","Ccedil":"\u00c7","Ccirc":"\u0108","Cconint":"\u2230","Cdot":"\u010a","Cedilla":"\u00b8","CenterDot":"\u00b7","Cfr":"\u212d","Chi":"\u03a7","CircleDot":"\u2299","CircleMinus":"\u2296","CirclePlus":"\u2295","CircleTimes":"\u2297","ClockwiseContourIntegral":"\u2232","CloseCurlyDoubleQuote":"\u201d","CloseCurlyQuote":"\u2019","Colon":"\u2237","Colone":"\u2a74","Congruent":"\u2261","Conint":"\u222f","ContourIntegral":"\u222e","Copf":"\u2102","Coproduct":"\u2210","CounterClockwiseContourIntegral":"\u2233","Cross":"\u2a2f","Cscr":"\ud835\udc9e","Cup":"\u22d3","CupCap":"\u224d","DD":"\u2145","DDotrahd":"\u2911","DJcy":"\u0402","DScy":"\u0405","DZcy":"\u040f","Dagger":"\u2021","Darr":"\u21a1","Dashv":"\u2ae4","Dcaron":"\u010e","Dcy":"\u0414","Del":"\u2207","Delta":"\u0394","Dfr":"\ud835\udd07","DiacriticalAcute":"\u00b4","DiacriticalDot":"\u02d9","DiacriticalDoubleAcute":"\u02dd","DiacriticalGrave":"`","DiacriticalTilde":"\u02dc","Diamond":"\u22c4","DifferentialD":"\u2146","Dopf":"\ud835\udd3b","Dot":"\u00a8","DotDot":"\u20dc","DotEqual":"\u2250","DoubleContourIntegral":"\u222f","DoubleDot":"\u00a8","DoubleDownArrow":"\u21d3","DoubleLeftArrow":"\u21d0","DoubleLeftRightArrow":"\u21d4","DoubleLeftTee":"\u2ae4","DoubleLongLeftArrow":"\u27f8","DoubleLongLeftRightArrow":"\u27fa","DoubleLongRightArrow":"\u27f9","DoubleRightArrow":"\u21d2","DoubleRightTee":"\u22a8","DoubleUpArrow":"\u21d1","DoubleUpDownArrow":"\u21d5","DoubleVerticalBar":"\u2225","DownArrow":"\u2193","DownArrowBar":"\u2913","DownArrowUpArrow":"\u21f5","DownBreve":"\u0311","DownLeftRightVector":"\u2950","DownLeftTeeVector":"\u295e","DownLeftVector":"\u21bd","DownLeftVectorBar":"\u2956","DownRightTeeVector":"\u295f","DownRightVector":"\u21c1","DownRightVectorBar":"\u2957","DownTee":"\u22a4","DownTeeArrow":"\u21a7","Downarrow":"\u21d3","Dscr":"\ud835\udc9f","Dstrok":"\u0110","ENG":"\u014a","ETH":"\u00d0","Eacute":"\u00c9","Ecaron":"\u011a","Ecirc":"\u00ca","Ecy":"\u042d","Edot":"\u0116","Efr":"\ud835\udd08","Egrave":"\u00c8","Element":"\u2208","Emacr":"\u0112","EmptySmallSquare":"\u25fb","EmptyVerySmallSquare":"\u25ab","Eogon":"\u0118","Eopf":"\ud835\udd3c","Epsilon":"\u0395","Equal":"\u2a75","EqualTilde":"\u2242","Equilibrium":"\u21cc","Escr":"\u2130","Esim":"\u2a73","Eta":"\u0397","Euml":"\u00cb","Exists":"\u2203","ExponentialE":"\u2147","Fcy":"\u0424","Ffr":"\ud835\udd09","FilledSmallSquare":"\u25fc","FilledVerySmallSquare":"\u25aa","Fopf":"\ud835\udd3d","ForAll":"\u2200","Fouriertrf":"\u2131","Fscr":"\u2131","GJcy":"\u0403","GT":">","Gamma":"\u0393","Gammad":"\u03dc","Gbreve":"\u011e","Gcedil":"\u0122","Gcirc":"\u011c","Gcy":"\u0413","Gdot":"\u0120","Gfr":"\ud835\udd0a","Gg":"\u22d9","Gopf":"\ud835\udd3e","GreaterEqual":"\u2265","GreaterEqualLess":"\u22db","GreaterFullEqual":"\u2267","GreaterGreater":"\u2aa2","GreaterLess":"\u2277","GreaterSlantEqual":"\u2a7e","GreaterTilde":"\u2273","Gscr":"\ud835\udca2","Gt":"\u226b","HARDcy":"\u042a","Hacek":"\u02c7","Hat":"^","Hcirc":"\u0124","Hfr":"\u210c","HilbertSpace":"\u210b","Hopf":"\u210d","HorizontalLine":"\u2500","Hscr":"\u210b","Hstrok":"\u0126","HumpDownHump":"\u224e","HumpEqual":"\u224f","IEcy":"\u0415","IJlig":"\u0132","IOcy":"\u0401","Iacute":"\u00cd","Icirc":"\u00ce","Icy":"\u0418","Idot":"\u0130","Ifr":"\u2111","Igrave":"\u00cc","Im":"\u2111","Imacr":"\u012a","ImaginaryI":"\u2148","Implies":"\u21d2","Int":"\u222c","Integral":"\u222b","Intersection":"\u22c2","InvisibleComma":"\u2063","InvisibleTimes":"\u2062","Iogon":"\u012e","Iopf":"\ud835\udd40","Iota":"\u0399","Iscr":"\u2110","Itilde":"\u0128","Iukcy":"\u0406","Iuml":"\u00cf","Jcirc":"\u0134","Jcy":"\u0419","Jfr":"\ud835\udd0d","Jopf":"\ud835\udd41","Jscr":"\ud835\udca5","Jsercy":"\u0408","Jukcy":"\u0404","KHcy":"\u0425","KJcy":"\u040c","Kappa":"\u039a","Kcedil":"\u0136","Kcy":"\u041a","Kfr":"\ud835\udd0e","Kopf":"\ud835\udd42","Kscr":"\ud835\udca6","LJcy":"\u0409","LT":"<","Lacute":"\u0139","Lambda":"\u039b","Lang":"\u27ea","Laplacetrf":"\u2112","Larr":"\u219e","Lcaron":"\u013d","Lcedil":"\u013b","Lcy":"\u041b","LeftAngleBracket":"\u27e8","LeftArrow":"\u2190","LeftArrowBar":"\u21e4","LeftArrowRightArrow":"\u21c6","LeftCeiling":"\u2308","LeftDoubleBracket":"\u27e6","LeftDownTeeVector":"\u2961","LeftDownVector":"\u21c3","LeftDownVectorBar":"\u2959","LeftFloor":"\u230a","LeftRightArrow":"\u2194","LeftRightVector":"\u294e","LeftTee":"\u22a3","LeftTeeArrow":"\u21a4","LeftTeeVector":"\u295a","LeftTriangle":"\u22b2","LeftTriangleBar":"\u29cf","LeftTriangleEqual":"\u22b4","LeftUpDownVector":"\u2951","LeftUpTeeVector":"\u2960","LeftUpVector":"\u21bf","LeftUpVectorBar":"\u2958","LeftVector":"\u21bc","LeftVectorBar":"\u2952","Leftarrow":"\u21d0","Leftrightarrow":"\u21d4","LessEqualGreater":"\u22da","LessFullEqual":"\u2266","LessGreater":"\u2276","LessLess":"\u2aa1","LessSlantEqual":"\u2a7d","LessTilde":"\u2272","Lfr":"\ud835\udd0f","Ll":"\u22d8","Lleftarrow":"\u21da","Lmidot":"\u013f","LongLeftArrow":"\u27f5","LongLeftRightArrow":"\u27f7","LongRightArrow":"\u27f6","Longleftarrow":"\u27f8","Longleftrightarrow":"\u27fa","Longrightarrow":"\u27f9","Lopf":"\ud835\udd43","LowerLeftArrow":"\u2199","LowerRightArrow":"\u2198","Lscr":"\u2112","Lsh":"\u21b0","Lstrok":"\u0141","Lt":"\u226a","Map":"\u2905","Mcy":"\u041c","MediumSpace":"\u205f","Mellintrf":"\u2133","Mfr":"\ud835\udd10","MinusPlus":"\u2213","Mopf":"\ud835\udd44","Mscr":"\u2133","Mu":"\u039c","NJcy":"\u040a","Nacute":"\u0143","Ncaron":"\u0147","Ncedil":"\u0145","Ncy":"\u041d","NegativeMediumSpace":"\u200b","NegativeThickSpace":"\u200b","NegativeThinSpace":"\u200b","NegativeVeryThinSpace":"\u200b","NestedGreaterGreater":"\u226b","NestedLessLess":"\u226a","NewLine":"\n","Nfr":"\ud835\udd11","NoBreak":"\u2060","NonBreakingSpace":"\u00a0","Nopf":"\u2115","Not":"\u2aec","NotCongruent":"\u2262","NotCupCap":"\u226d","NotDoubleVerticalBar":"\u2226","NotElement":"\u2209","NotEqual":"\u2260","NotEqualTilde":"\u2242\u0338","NotExists":"\u2204","NotGreater":"\u226f","NotGreaterEqual":"\u2271","NotGreaterFullEqual":"\u2267\u0338","NotGreaterGreater":"\u226b\u0338","NotGreaterLess":"\u2279","NotGreaterSlantEqual":"\u2a7e\u0338","NotGreaterTilde":"\u2275","NotHumpDownHump":"\u224e\u0338","NotHumpEqual":"\u224f\u0338","NotLeftTriangle":"\u22ea","NotLeftTriangleBar":"\u29cf\u0338","NotLeftTriangleEqual":"\u22ec","NotLess":"\u226e","NotLessEqual":"\u2270","NotLessGreater":"\u2278","NotLessLess":"\u226a\u0338","NotLessSlantEqual":"\u2a7d\u0338","NotLessTilde":"\u2274","NotNestedGreaterGreater":"\u2aa2\u0338","NotNestedLessLess":"\u2aa1\u0338","NotPrecedes":"\u2280","NotPrecedesEqual":"\u2aaf\u0338","NotPrecedesSlantEqual":"\u22e0","NotReverseElement":"\u220c","NotRightTriangle":"\u22eb","NotRightTriangleBar":"\u29d0\u0338","NotRightTriangleEqual":"\u22ed","NotSquareSubset":"\u228f\u0338","NotSquareSubsetEqual":"\u22e2","NotSquareSuperset":"\u2290\u0338","NotSquareSupersetEqual":"\u22e3","NotSubset":"\u2282\u20d2","NotSubsetEqual":"\u2288","NotSucceeds":"\u2281","NotSucceedsEqual":"\u2ab0\u0338","NotSucceedsSlantEqual":"\u22e1","NotSucceedsTilde":"\u227f\u0338","NotSuperset":"\u2283\u20d2","NotSupersetEqual":"\u2289","NotTilde":"\u2241","NotTildeEqual":"\u2244","NotTildeFullEqual":"\u2247","NotTildeTilde":"\u2249","NotVerticalBar":"\u2224","Nscr":"\ud835\udca9","Ntilde":"\u00d1","Nu":"\u039d","OElig":"\u0152","Oacute":"\u00d3","Ocirc":"\u00d4","Ocy":"\u041e","Odblac":"\u0150","Ofr":"\ud835\udd12","Ograve":"\u00d2","Omacr":"\u014c","Omega":"\u03a9","Omicron":"\u039f","Oopf":"\ud835\udd46","OpenCurlyDoubleQuote":"\u201c","OpenCurlyQuote":"\u2018","Or":"\u2a54","Oscr":"\ud835\udcaa","Oslash":"\u00d8","Otilde":"\u00d5","Otimes":"\u2a37","Ouml":"\u00d6","OverBar":"\u203e","OverBrace":"\u23de","OverBracket":"\u23b4","OverParenthesis":"\u23dc","PartialD":"\u2202","Pcy":"\u041f","Pfr":"\ud835\udd13","Phi":"\u03a6","Pi":"\u03a0","PlusMinus":"\u00b1","Poincareplane":"\u210c","Popf":"\u2119","Pr":"\u2abb","Precedes":"\u227a","PrecedesEqual":"\u2aaf","PrecedesSlantEqual":"\u227c","PrecedesTilde":"\u227e","Prime":"\u2033","Product":"\u220f","Proportion":"\u2237","Proportional":"\u221d","Pscr":"\ud835\udcab","Psi":"\u03a8","QUOT":"\"","Qfr":"\ud835\udd14","Qopf":"\u211a","Qscr":"\ud835\udcac","RBarr":"\u2910","REG":"\u00ae","Racute":"\u0154","Rang":"\u27eb","Rarr":"\u21a0","Rarrtl":"\u2916","Rcaron":"\u0158","Rcedil":"\u0156","Rcy":"\u0420","Re":"\u211c","ReverseElement":"\u220b","ReverseEquilibrium":"\u21cb","ReverseUpEquilibrium":"\u296f","Rfr":"\u211c","Rho":"\u03a1","RightAngleBracket":"\u27e9","RightArrow":"\u2192","RightArrowBar":"\u21e5","RightArrowLeftArrow":"\u21c4","RightCeiling":"\u2309","RightDoubleBracket":"\u27e7","RightDownTeeVector":"\u295d","RightDownVector":"\u21c2","RightDownVectorBar":"\u2955","RightFloor":"\u230b","RightTee":"\u22a2","RightTeeArrow":"\u21a6","RightTeeVector":"\u295b","RightTriangle":"\u22b3","RightTriangleBar":"\u29d0","RightTriangleEqual":"\u22b5","RightUpDownVector":"\u294f","RightUpTeeVector":"\u295c","RightUpVector":"\u21be","RightUpVectorBar":"\u2954","RightVector":"\u21c0","RightVectorBar":"\u2953","Rightarrow":"\u21d2","Ropf":"\u211d","RoundImplies":"\u2970","Rrightarrow":"\u21db","Rscr":"\u211b","Rsh":"\u21b1","RuleDelayed":"\u29f4","SHCHcy":"\u0429","SHcy":"\u0428","SOFTcy":"\u042c","Sacute":"\u015a","Sc":"\u2abc","Scaron":"\u0160","Scedil":"\u015e","Scirc":"\u015c","Scy":"\u0421","Sfr":"\ud835\udd16","ShortDownArrow":"\u2193","ShortLeftArrow":"\u2190","ShortRightArrow":"\u2192","ShortUpArrow":"\u2191","Sigma":"\u03a3","SmallCircle":"\u2218","Sopf":"\ud835\udd4a","Sqrt":"\u221a","Square":"\u25a1","SquareIntersection":"\u2293","SquareSubset":"\u228f","SquareSubsetEqual":"\u2291","SquareSuperset":"\u2290","SquareSupersetEqual":"\u2292","SquareUnion":"\u2294","Sscr":"\ud835\udcae","Star":"\u22c6","Sub":"\u22d0","Subset":"\u22d0","SubsetEqual":"\u2286","Succeeds":"\u227b","SucceedsEqual":"\u2ab0","SucceedsSlantEqual":"\u227d","SucceedsTilde":"\u227f","SuchThat":"\u220b","Sum":"\u2211","Sup":"\u22d1","Superset":"\u2283","SupersetEqual":"\u2287","Supset":"\u22d1","THORN":"\u00de","TRADE":"\u2122","TSHcy":"\u040b","TScy":"\u0426","Tab":"\t","Tau":"\u03a4","Tcaron":"\u0164","Tcedil":"\u0162","Tcy":"\u0422","Tfr":"\ud835\udd17","Therefore":"\u2234","Theta":"\u0398","ThickSpace":"\u205f\u200a","ThinSpace":"\u2009","Tilde":"\u223c","TildeEqual":"\u2243","TildeFullEqual":"\u2245","TildeTilde":"\u2248","Topf":"\ud835\udd4b","TripleDot":"\u20db","Tscr":"\ud835\udcaf","Tstrok":"\u0166","Uacute":"\u00da","Uarr":"\u219f","Uarrocir":"\u2949","Ubrcy":"\u040e","Ubreve":"\u016c","Ucirc":"\u00db","Ucy":"\u0423","Udblac":"\u0170","Ufr":"\ud835\udd18","Ugrave":"\u00d9","Umacr":"\u016a","UnderBar":"_","UnderBrace":"\u23df","UnderBracket":"\u23b5","UnderParenthesis":"\u23dd","Union":"\u22c3","UnionPlus":"\u228e","Uogon":"\u0172","Uopf":"\ud835\udd4c","UpArrow":"\u2191","UpArrowBar":"\u2912","UpArrowDownArrow":"\u21c5","UpDownArrow":"\u2195","UpEquilibrium":"\u296e","UpTee":"\u22a5","UpTeeArrow":"\u21a5","Uparrow":"\u21d1","Updownarrow":"\u21d5","UpperLeftArrow":"\u2196","UpperRightArrow":"\u2197","Upsi":"\u03d2","Upsilon":"\u03a5","Uring":"\u016e","Uscr":"\ud835\udcb0","Utilde":"\u0168","Uuml":"\u00dc","VDash":"\u22ab","Vbar":"\u2aeb","Vcy":"\u0412","Vdash":"\u22a9","Vdashl":"\u2ae6","Vee":"\u22c1","Verbar":"\u2016","Vert":"\u2016","VerticalBar":"\u2223","VerticalLine":"|","VerticalSeparator":"\u2758","VerticalTilde":"\u2240","VeryThinSpace":"\u200a","Vfr":"\ud835\udd19","Vopf":"\ud835\udd4d","Vscr":"\ud835\udcb1","Vvdash":"\u22aa","Wcirc":"\u0174","Wedge":"\u22c0","Wfr":"\ud835\udd1a","Wopf":"\ud835\udd4e","Wscr":"\ud835\udcb2","Xfr":"\ud835\udd1b","Xi":"\u039e","Xopf":"\ud835\udd4f","Xscr":"\ud835\udcb3","YAcy":"\u042f","YIcy":"\u0407","YUcy":"\u042e","Yacute":"\u00dd","Ycirc":"\u0176","Ycy":"\u042b","Yfr":"\ud835\udd1c","Yopf":"\ud835\udd50","Yscr":"\ud835\udcb4","Yuml":"\u0178","ZHcy":"\u0416","Zacute":"\u0179","Zcaron":"\u017d","Zcy":"\u0417","Zdot":"\u017b","ZeroWidthSpace":"\u200b","Zeta":"\u0396","Zfr":"\u2128","Zopf":"\u2124","Zscr":"\ud835\udcb5","aacute":"\u00e1","abreve":"\u0103","ac":"\u223e","acE":"\u223e\u0333","acd":"\u223f","acirc":"\u00e2","acute":"\u00b4","acy":"\u0430","aelig":"\u00e6","af":"\u2061","afr":"\ud835\udd1e","agrave":"\u00e0","alefsym":"\u2135","aleph":"\u2135","alpha":"\u03b1","amacr":"\u0101","amalg":"\u2a3f","amp":"&","and":"\u2227","andand":"\u2a55","andd":"\u2a5c","andslope":"\u2a58","andv":"\u2a5a","ang":"\u2220","ange":"\u29a4","angle":"\u2220","angmsd":"\u2221","angmsdaa":"\u29a8","angmsdab":"\u29a9","angmsdac":"\u29aa","angmsdad":"\u29ab","angmsdae":"\u29ac","angmsdaf":"\u29ad","angmsdag":"\u29ae","angmsdah":"\u29af","angrt":"\u221f","angrtvb":"\u22be","angrtvbd":"\u299d","angsph":"\u2222","angst":"\u00c5","angzarr":"\u237c","aogon":"\u0105","aopf":"\ud835\udd52","ap":"\u2248","apE":"\u2a70","apacir":"\u2a6f","ape":"\u224a","apid":"\u224b","apos":"'","approx":"\u2248","approxeq":"\u224a","aring":"\u00e5","ascr":"\ud835\udcb6","ast":"*","asymp":"\u2248","asympeq":"\u224d","atilde":"\u00e3","auml":"\u00e4","awconint":"\u2233","awint":"\u2a11","bNot":"\u2aed","backcong":"\u224c","backepsilon":"\u03f6","backprime":"\u2035","backsim":"\u223d","backsimeq":"\u22cd","barvee":"\u22bd","barwed":"\u2305","barwedge":"\u2305","bbrk":"\u23b5","bbrktbrk":"\u23b6","bcong":"\u224c","bcy":"\u0431","bdquo":"\u201e","becaus":"\u2235","because":"\u2235","bemptyv":"\u29b0","bepsi":"\u03f6","bernou":"\u212c","beta":"\u03b2","beth":"\u2136","between":"\u226c","bfr":"\ud835\udd1f","bigcap":"\u22c2","bigcirc":"\u25ef","bigcup":"\u22c3","bigodot":"\u2a00","bigoplus":"\u2a01","bigotimes":"\u2a02","bigsqcup":"\u2a06","bigstar":"\u2605","bigtriangledown":"\u25bd","bigtriangleup":"\u25b3","biguplus":"\u2a04","bigvee":"\u22c1","bigwedge":"\u22c0","bkarow":"\u290d","blacklozenge":"\u29eb","blacksquare":"\u25aa","blacktriangle":"\u25b4","blacktriangledown":"\u25be","blacktriangleleft":"\u25c2","blacktriangleright":"\u25b8","blank":"\u2423","blk12":"\u2592","blk14":"\u2591","blk34":"\u2593","block":"\u2588","bne":"=\u20e5","bnequiv":"\u2261\u20e5","bnot":"\u2310","bopf":"\ud835\udd53","bot":"\u22a5","bottom":"\u22a5","bowtie":"\u22c8","boxDL":"\u2557","boxDR":"\u2554","boxDl":"\u2556","boxDr":"\u2553","boxH":"\u2550","boxHD":"\u2566","boxHU":"\u2569","boxHd":"\u2564","boxHu":"\u2567","boxUL":"\u255d","boxUR":"\u255a","boxUl":"\u255c","boxUr":"\u2559","boxV":"\u2551","boxVH":"\u256c","boxVL":"\u2563","boxVR":"\u2560","boxVh":"\u256b","boxVl":"\u2562","boxVr":"\u255f","boxbox":"\u29c9","boxdL":"\u2555","boxdR":"\u2552","boxdl":"\u2510","boxdr":"\u250c","boxh":"\u2500","boxhD":"\u2565","boxhU":"\u2568","boxhd":"\u252c","boxhu":"\u2534","boxminus":"\u229f","boxplus":"\u229e","boxtimes":"\u22a0","boxuL":"\u255b","boxuR":"\u2558","boxul":"\u2518","boxur":"\u2514","boxv":"\u2502","boxvH":"\u256a","boxvL":"\u2561","boxvR":"\u255e","boxvh":"\u253c","boxvl":"\u2524","boxvr":"\u251c","bprime":"\u2035","breve":"\u02d8","brvbar":"\u00a6","bscr":"\ud835\udcb7","bsemi":"\u204f","bsim":"\u223d","bsime":"\u22cd","bsol":"\\","bsolb":"\u29c5","bsolhsub":"\u27c8","bull":"\u2022","bullet":"\u2022","bump":"\u224e","bumpE":"\u2aae","bumpe":"\u224f","bumpeq":"\u224f","cacute":"\u0107","cap":"\u2229","capand":"\u2a44","capbrcup":"\u2a49","capcap":"\u2a4b","capcup":"\u2a47","capdot":"\u2a40","caps":"\u2229\ufe00","caret":"\u2041","caron":"\u02c7","ccaps":"\u2a4d","ccaron":"\u010d","ccedil":"\u00e7","ccirc":"\u0109","ccups":"\u2a4c","ccupssm":"\u2a50","cdot":"\u010b","cedil":"\u00b8","cemptyv":"\u29b2","cent":"\u00a2","centerdot":"\u00b7","cfr":"\ud835\udd20","chcy":"\u0447","check":"\u2713","checkmark":"\u2713","chi":"\u03c7","cir":"\u25cb","cirE":"\u29c3","circ":"\u02c6","circeq":"\u2257","circlearrowleft":"\u21ba","circlearrowright":"\u21bb","circledR":"\u00ae","circledS":"\u24c8","circledast":"\u229b","circledcirc":"\u229a","circleddash":"\u229d","cire":"\u2257","cirfnint":"\u2a10","cirmid":"\u2aef","cirscir":"\u29c2","clubs":"\u2663","clubsuit":"\u2663","colon":":","colone":"\u2254","coloneq":"\u2254","comma":",","commat":"@","comp":"\u2201","compfn":"\u2218","complement":"\u2201","complexes":"\u2102","cong":"\u2245","congdot":"\u2a6d","conint":"\u222e","copf":"\ud835\udd54","coprod":"\u2210","copy":"\u00a9","copysr":"\u2117","crarr":"\u21b5","cross":"\u2717","cscr":"\ud835\udcb8","csub":"\u2acf","csube":"\u2ad1","csup":"\u2ad0","csupe":"\u2ad2","ctdot":"\u22ef","cudarrl":"\u2938","cudarrr":"\u2935","cuepr":"\u22de","cuesc":"\u22df","cularr":"\u21b6","cularrp":"\u293d","cup":"\u222a","cupbrcap":"\u2a48","cupcap":"\u2a46","cupcup":"\u2a4a","cupdot":"\u228d","cupor":"\u2a45","cups":"\u222a\ufe00","curarr":"\u21b7","curarrm":"\u293c","curlyeqprec":"\u22de","curlyeqsucc":"\u22df","curlyvee":"\u22ce","curlywedge":"\u22cf","curren":"\u00a4","curvearrowleft":"\u21b6","curvearrowright":"\u21b7","cuvee":"\u22ce","cuwed":"\u22cf","cwconint":"\u2232","cwint":"\u2231","cylcty":"\u232d","dArr":"\u21d3","dHar":"\u2965","dagger":"\u2020","daleth":"\u2138","darr":"\u2193","dash":"\u2010","dashv":"\u22a3","dbkarow":"\u290f","dblac":"\u02dd","dcaron":"\u010f","dcy":"\u0434","dd":"\u2146","ddagger":"\u2021","ddarr":"\u21ca","ddotseq":"\u2a77","deg":"\u00b0","delta":"\u03b4","demptyv":"\u29b1","dfisht":"\u297f","dfr":"\ud835\udd21","dharl":"\u21c3","dharr":"\u21c2","diam":"\u22c4","diamond":"\u22c4","diamondsuit":"\u2666","diams":"\u2666","die":"\u00a8","digamma":"\u03dd","disin":"\u22f2","div":"\u00f7","divide":"\u00f7","divideontimes":"\u22c7","divonx":"\u22c7","djcy":"\u0452","dlcorn":"\u231e","dlcrop":"\u230d","dollar":"$","dopf":"\ud835\udd55","dot":"\u02d9","doteq":"\u2250","doteqdot":"\u2251","dotminus":"\u2238","dotplus":"\u2214","dotsquare":"\u22a1","doublebarwedge":"\u2306","downarrow":"\u2193","downdownarrows":"\u21ca","downharpoonleft":"\u21c3","downharpoonright":"\u21c2","drbkarow":"\u2910","drcorn":"\u231f","drcrop":"\u230c","dscr":"\ud835\udcb9","dscy":"\u0455","dsol":"\u29f6","dstrok":"\u0111","dtdot":"\u22f1","dtri":"\u25bf","dtrif":"\u25be","duarr":"\u21f5","duhar":"\u296f","dwangle":"\u29a6","dzcy":"\u045f","dzigrarr":"\u27ff","eDDot":"\u2a77","eDot":"\u2251","eacute":"\u00e9","easter":"\u2a6e","ecaron":"\u011b","ecir":"\u2256","ecirc":"\u00ea","ecolon":"\u2255","ecy":"\u044d","edot":"\u0117","ee":"\u2147","efDot":"\u2252","efr":"\ud835\udd22","eg":"\u2a9a","egrave":"\u00e8","egs":"\u2a96","egsdot":"\u2a98","el":"\u2a99","elinters":"\u23e7","ell":"\u2113","els":"\u2a95","elsdot":"\u2a97","emacr":"\u0113","empty":"\u2205","emptyset":"\u2205","emptyv":"\u2205","emsp":"\u2003","emsp13":"\u2004","emsp14":"\u2005","eng":"\u014b","ensp":"\u2002","eogon":"\u0119","eopf":"\ud835\udd56","epar":"\u22d5","eparsl":"\u29e3","eplus":"\u2a71","epsi":"\u03b5","epsilon":"\u03b5","epsiv":"\u03f5","eqcirc":"\u2256","eqcolon":"\u2255","eqsim":"\u2242","eqslantgtr":"\u2a96","eqslantless":"\u2a95","equals":"=","equest":"\u225f","equiv":"\u2261","equivDD":"\u2a78","eqvparsl":"\u29e5","erDot":"\u2253","erarr":"\u2971","escr":"\u212f","esdot":"\u2250","esim":"\u2242","eta":"\u03b7","eth":"\u00f0","euml":"\u00eb","euro":"\u20ac","excl":"!","exist":"\u2203","expectation":"\u2130","exponentiale":"\u2147","fallingdotseq":"\u2252","fcy":"\u0444","female":"\u2640","ffilig":"\ufb03","fflig":"\ufb00","ffllig":"\ufb04","ffr":"\ud835\udd23","filig":"\ufb01","fjlig":"fj","flat":"\u266d","fllig":"\ufb02","fltns":"\u25b1","fnof":"\u0192","fopf":"\ud835\udd57","forall":"\u2200","fork":"\u22d4","forkv":"\u2ad9","fpartint":"\u2a0d","frac12":"\u00bd","frac13":"\u2153","frac14":"\u00bc","frac15":"\u2155","frac16":"\u2159","frac18":"\u215b","frac23":"\u2154","frac25":"\u2156","frac34":"\u00be","frac35":"\u2157","frac38":"\u215c","frac45":"\u2158","frac56":"\u215a","frac58":"\u215d","frac78":"\u215e","frasl":"\u2044","frown":"\u2322","fscr":"\ud835\udcbb","gE":"\u2267","gEl":"\u2a8c","gacute":"\u01f5","gamma":"\u03b3","gammad":"\u03dd","gap":"\u2a86","gbreve":"\u011f","gcirc":"\u011d","gcy":"\u0433","gdot":"\u0121","ge":"\u2265","gel":"\u22db","geq":"\u2265","geqq":"\u2267","geqslant":"\u2a7e","ges":"\u2a7e","gescc":"\u2aa9","gesdot":"\u2a80","gesdoto":"\u2a82","gesdotol":"\u2a84","gesl":"\u22db\ufe00","gesles":"\u2a94","gfr":"\ud835\udd24","gg":"\u226b","ggg":"\u22d9","gimel":"\u2137","gjcy":"\u0453","gl":"\u2277","glE":"\u2a92","gla":"\u2aa5","glj":"\u2aa4","gnE":"\u2269","gnap":"\u2a8a","gnapprox":"\u2a8a","gne":"\u2a88","gneq":"\u2a88","gneqq":"\u2269","gnsim":"\u22e7","gopf":"\ud835\udd58","grave":"`","gscr":"\u210a","gsim":"\u2273","gsime":"\u2a8e","gsiml":"\u2a90","gt":">","gtcc":"\u2aa7","gtcir":"\u2a7a","gtdot":"\u22d7","gtlPar":"\u2995","gtquest":"\u2a7c","gtrapprox":"\u2a86","gtrarr":"\u2978","gtrdot":"\u22d7","gtreqless":"\u22db","gtreqqless":"\u2a8c","gtrless":"\u2277","gtrsim":"\u2273","gvertneqq":"\u2269\ufe00","gvnE":"\u2269\ufe00","hArr":"\u21d4","hairsp":"\u200a","half":"\u00bd","hamilt":"\u210b","hardcy":"\u044a","harr":"\u2194","harrcir":"\u2948","harrw":"\u21ad","hbar":"\u210f","hcirc":"\u0125","hearts":"\u2665","heartsuit":"\u2665","hellip":"\u2026","hercon":"\u22b9","hfr":"\ud835\udd25","hksearow":"\u2925","hkswarow":"\u2926","hoarr":"\u21ff","homtht":"\u223b","hookleftarrow":"\u21a9","hookrightarrow":"\u21aa","hopf":"\ud835\udd59","horbar":"\u2015","hscr":"\ud835\udcbd","hslash":"\u210f","hstrok":"\u0127","hybull":"\u2043","hyphen":"\u2010","iacute":"\u00ed","ic":"\u2063","icirc":"\u00ee","icy":"\u0438","iecy":"\u0435","iexcl":"\u00a1","iff":"\u21d4","ifr":"\ud835\udd26","igrave":"\u00ec","ii":"\u2148","iiiint":"\u2a0c","iiint":"\u222d","iinfin":"\u29dc","iiota":"\u2129","ijlig":"\u0133","imacr":"\u012b","image":"\u2111","imagline":"\u2110","imagpart":"\u2111","imath":"\u0131","imof":"\u22b7","imped":"\u01b5","in":"\u2208","incare":"\u2105","infin":"\u221e","infintie":"\u29dd","inodot":"\u0131","int":"\u222b","intcal":"\u22ba","integers":"\u2124","intercal":"\u22ba","intlarhk":"\u2a17","intprod":"\u2a3c","iocy":"\u0451","iogon":"\u012f","iopf":"\ud835\udd5a","iota":"\u03b9","iprod":"\u2a3c","iquest":"\u00bf","iscr":"\ud835\udcbe","isin":"\u2208","isinE":"\u22f9","isindot":"\u22f5","isins":"\u22f4","isinsv":"\u22f3","isinv":"\u2208","it":"\u2062","itilde":"\u0129","iukcy":"\u0456","iuml":"\u00ef","jcirc":"\u0135","jcy":"\u0439","jfr":"\ud835\udd27","jmath":"\u0237","jopf":"\ud835\udd5b","jscr":"\ud835\udcbf","jsercy":"\u0458","jukcy":"\u0454","kappa":"\u03ba","kappav":"\u03f0","kcedil":"\u0137","kcy":"\u043a","kfr":"\ud835\udd28","kgreen":"\u0138","khcy":"\u0445","kjcy":"\u045c","kopf":"\ud835\udd5c","kscr":"\ud835\udcc0","lAarr":"\u21da","lArr":"\u21d0","lAtail":"\u291b","lBarr":"\u290e","lE":"\u2266","lEg":"\u2a8b","lHar":"\u2962","lacute":"\u013a","laemptyv":"\u29b4","lagran":"\u2112","lambda":"\u03bb","lang":"\u27e8","langd":"\u2991","langle":"\u27e8","lap":"\u2a85","laquo":"\u00ab","larr":"\u2190","larrb":"\u21e4","larrbfs":"\u291f","larrfs":"\u291d","larrhk":"\u21a9","larrlp":"\u21ab","larrpl":"\u2939","larrsim":"\u2973","larrtl":"\u21a2","lat":"\u2aab","latail":"\u2919","late":"\u2aad","lates":"\u2aad\ufe00","lbarr":"\u290c","lbbrk":"\u2772","lbrace":"{","lbrack":"[","lbrke":"\u298b","lbrksld":"\u298f","lbrkslu":"\u298d","lcaron":"\u013e","lcedil":"\u013c","lceil":"\u2308","lcub":"{","lcy":"\u043b","ldca":"\u2936","ldquo":"\u201c","ldquor":"\u201e","ldrdhar":"\u2967","ldrushar":"\u294b","ldsh":"\u21b2","le":"\u2264","leftarrow":"\u2190","leftarrowtail":"\u21a2","leftharpoondown":"\u21bd","leftharpoonup":"\u21bc","leftleftarrows":"\u21c7","leftrightarrow":"\u2194","leftrightarrows":"\u21c6","leftrightharpoons":"\u21cb","leftrightsquigarrow":"\u21ad","leftthreetimes":"\u22cb","leg":"\u22da","leq":"\u2264","leqq":"\u2266","leqslant":"\u2a7d","les":"\u2a7d","lescc":"\u2aa8","lesdot":"\u2a7f","lesdoto":"\u2a81","lesdotor":"\u2a83","lesg":"\u22da\ufe00","lesges":"\u2a93","lessapprox":"\u2a85","lessdot":"\u22d6","lesseqgtr":"\u22da","lesseqqgtr":"\u2a8b","lessgtr":"\u2276","lesssim":"\u2272","lfisht":"\u297c","lfloor":"\u230a","lfr":"\ud835\udd29","lg":"\u2276","lgE":"\u2a91","lhard":"\u21bd","lharu":"\u21bc","lharul":"\u296a","lhblk":"\u2584","ljcy":"\u0459","ll":"\u226a","llarr":"\u21c7","llcorner":"\u231e","llhard":"\u296b","lltri":"\u25fa","lmidot":"\u0140","lmoust":"\u23b0","lmoustache":"\u23b0","lnE":"\u2268","lnap":"\u2a89","lnapprox":"\u2a89","lne":"\u2a87","lneq":"\u2a87","lneqq":"\u2268","lnsim":"\u22e6","loang":"\u27ec","loarr":"\u21fd","lobrk":"\u27e6","longleftarrow":"\u27f5","longleftrightarrow":"\u27f7","longmapsto":"\u27fc","longrightarrow":"\u27f6","looparrowleft":"\u21ab","looparrowright":"\u21ac","lopar":"\u2985","lopf":"\ud835\udd5d","loplus":"\u2a2d","lotimes":"\u2a34","lowast":"\u2217","lowbar":"_","loz":"\u25ca","lozenge":"\u25ca","lozf":"\u29eb","lpar":"(","lparlt":"\u2993","lrarr":"\u21c6","lrcorner":"\u231f","lrhar":"\u21cb","lrhard":"\u296d","lrm":"\u200e","lrtri":"\u22bf","lsaquo":"\u2039","lscr":"\ud835\udcc1","lsh":"\u21b0","lsim":"\u2272","lsime":"\u2a8d","lsimg":"\u2a8f","lsqb":"[","lsquo":"\u2018","lsquor":"\u201a","lstrok":"\u0142","lt":"<","ltcc":"\u2aa6","ltcir":"\u2a79","ltdot":"\u22d6","lthree":"\u22cb","ltimes":"\u22c9","ltlarr":"\u2976","ltquest":"\u2a7b","ltrPar":"\u2996","ltri":"\u25c3","ltrie":"\u22b4","ltrif":"\u25c2","lurdshar":"\u294a","luruhar":"\u2966","lvertneqq":"\u2268\ufe00","lvnE":"\u2268\ufe00","mDDot":"\u223a","macr":"\u00af","male":"\u2642","malt":"\u2720","maltese":"\u2720","map":"\u21a6","mapsto":"\u21a6","mapstodown":"\u21a7","mapstoleft":"\u21a4","mapstoup":"\u21a5","marker":"\u25ae","mcomma":"\u2a29","mcy":"\u043c","mdash":"\u2014","measuredangle":"\u2221","mfr":"\ud835\udd2a","mho":"\u2127","micro":"\u00b5","mid":"\u2223","midast":"*","midcir":"\u2af0","middot":"\u00b7","minus":"\u2212","minusb":"\u229f","minusd":"\u2238","minusdu":"\u2a2a","mlcp":"\u2adb","mldr":"\u2026","mnplus":"\u2213","models":"\u22a7","mopf":"\ud835\udd5e","mp":"\u2213","mscr":"\ud835\udcc2","mstpos":"\u223e","mu":"\u03bc","multimap":"\u22b8","mumap":"\u22b8","nGg":"\u22d9\u0338","nGt":"\u226b\u20d2","nGtv":"\u226b\u0338","nLeftarrow":"\u21cd","nLeftrightarrow":"\u21ce","nLl":"\u22d8\u0338","nLt":"\u226a\u20d2","nLtv":"\u226a\u0338","nRightarrow":"\u21cf","nVDash":"\u22af","nVdash":"\u22ae","nabla":"\u2207","nacute":"\u0144","nang":"\u2220\u20d2","nap":"\u2249","napE":"\u2a70\u0338","napid":"\u224b\u0338","napos":"\u0149","napprox":"\u2249","natur":"\u266e","natural":"\u266e","naturals":"\u2115","nbsp":"\u00a0","nbump":"\u224e\u0338","nbumpe":"\u224f\u0338","ncap":"\u2a43","ncaron":"\u0148","ncedil":"\u0146","ncong":"\u2247","ncongdot":"\u2a6d\u0338","ncup":"\u2a42","ncy":"\u043d","ndash":"\u2013","ne":"\u2260","neArr":"\u21d7","nearhk":"\u2924","nearr":"\u2197","nearrow":"\u2197","nedot":"\u2250\u0338","nequiv":"\u2262","nesear":"\u2928","nesim":"\u2242\u0338","nexist":"\u2204","nexists":"\u2204","nfr":"\ud835\udd2b","ngE":"\u2267\u0338","nge":"\u2271","ngeq":"\u2271","ngeqq":"\u2267\u0338","ngeqslant":"\u2a7e\u0338","nges":"\u2a7e\u0338","ngsim":"\u2275","ngt":"\u226f","ngtr":"\u226f","nhArr":"\u21ce","nharr":"\u21ae","nhpar":"\u2af2","ni":"\u220b","nis":"\u22fc","nisd":"\u22fa","niv":"\u220b","njcy":"\u045a","nlArr":"\u21cd","nlE":"\u2266\u0338","nlarr":"\u219a","nldr":"\u2025","nle":"\u2270","nleftarrow":"\u219a","nleftrightarrow":"\u21ae","nleq":"\u2270","nleqq":"\u2266\u0338","nleqslant":"\u2a7d\u0338","nles":"\u2a7d\u0338","nless":"\u226e","nlsim":"\u2274","nlt":"\u226e","nltri":"\u22ea","nltrie":"\u22ec","nmid":"\u2224","nopf":"\ud835\udd5f","not":"\u00ac","notin":"\u2209","notinE":"\u22f9\u0338","notindot":"\u22f5\u0338","notinva":"\u2209","notinvb":"\u22f7","notinvc":"\u22f6","notni":"\u220c","notniva":"\u220c","notnivb":"\u22fe","notnivc":"\u22fd","npar":"\u2226","nparallel":"\u2226","nparsl":"\u2afd\u20e5","npart":"\u2202\u0338","npolint":"\u2a14","npr":"\u2280","nprcue":"\u22e0","npre":"\u2aaf\u0338","nprec":"\u2280","npreceq":"\u2aaf\u0338","nrArr":"\u21cf","nrarr":"\u219b","nrarrc":"\u2933\u0338","nrarrw":"\u219d\u0338","nrightarrow":"\u219b","nrtri":"\u22eb","nrtrie":"\u22ed","nsc":"\u2281","nsccue":"\u22e1","nsce":"\u2ab0\u0338","nscr":"\ud835\udcc3","nshortmid":"\u2224","nshortparallel":"\u2226","nsim":"\u2241","nsime":"\u2244","nsimeq":"\u2244","nsmid":"\u2224","nspar":"\u2226","nsqsube":"\u22e2","nsqsupe":"\u22e3","nsub":"\u2284","nsubE":"\u2ac5\u0338","nsube":"\u2288","nsubset":"\u2282\u20d2","nsubseteq":"\u2288","nsubseteqq":"\u2ac5\u0338","nsucc":"\u2281","nsucceq":"\u2ab0\u0338","nsup":"\u2285","nsupE":"\u2ac6\u0338","nsupe":"\u2289","nsupset":"\u2283\u20d2","nsupseteq":"\u2289","nsupseteqq":"\u2ac6\u0338","ntgl":"\u2279","ntilde":"\u00f1","ntlg":"\u2278","ntriangleleft":"\u22ea","ntrianglelefteq":"\u22ec","ntriangleright":"\u22eb","ntrianglerighteq":"\u22ed","nu":"\u03bd","num":"#","numero":"\u2116","numsp":"\u2007","nvDash":"\u22ad","nvHarr":"\u2904","nvap":"\u224d\u20d2","nvdash":"\u22ac","nvge":"\u2265\u20d2","nvgt":">\u20d2","nvinfin":"\u29de","nvlArr":"\u2902","nvle":"\u2264\u20d2","nvlt":"<\u20d2","nvltrie":"\u22b4\u20d2","nvrArr":"\u2903","nvrtrie":"\u22b5\u20d2","nvsim":"\u223c\u20d2","nwArr":"\u21d6","nwarhk":"\u2923","nwarr":"\u2196","nwarrow":"\u2196","nwnear":"\u2927","oS":"\u24c8","oacute":"\u00f3","oast":"\u229b","ocir":"\u229a","ocirc":"\u00f4","ocy":"\u043e","odash":"\u229d","odblac":"\u0151","odiv":"\u2a38","odot":"\u2299","odsold":"\u29bc","oelig":"\u0153","ofcir":"\u29bf","ofr":"\ud835\udd2c","ogon":"\u02db","ograve":"\u00f2","ogt":"\u29c1","ohbar":"\u29b5","ohm":"\u03a9","oint":"\u222e","olarr":"\u21ba","olcir":"\u29be","olcross":"\u29bb","oline":"\u203e","olt":"\u29c0","omacr":"\u014d","omega":"\u03c9","omicron":"\u03bf","omid":"\u29b6","ominus":"\u2296","oopf":"\ud835\udd60","opar":"\u29b7","operp":"\u29b9","oplus":"\u2295","or":"\u2228","orarr":"\u21bb","ord":"\u2a5d","order":"\u2134","orderof":"\u2134","ordf":"\u00aa","ordm":"\u00ba","origof":"\u22b6","oror":"\u2a56","orslope":"\u2a57","orv":"\u2a5b","oscr":"\u2134","oslash":"\u00f8","osol":"\u2298","otilde":"\u00f5","otimes":"\u2297","otimesas":"\u2a36","ouml":"\u00f6","ovbar":"\u233d","par":"\u2225","para":"\u00b6","parallel":"\u2225","parsim":"\u2af3","parsl":"\u2afd","part":"\u2202","pcy":"\u043f","percnt":"%","period":".","permil":"\u2030","perp":"\u22a5","pertenk":"\u2031","pfr":"\ud835\udd2d","phi":"\u03c6","phiv":"\u03d5","phmmat":"\u2133","phone":"\u260e","pi":"\u03c0","pitchfork":"\u22d4","piv":"\u03d6","planck":"\u210f","planckh":"\u210e","plankv":"\u210f","plus":"+","plusacir":"\u2a23","plusb":"\u229e","pluscir":"\u2a22","plusdo":"\u2214","plusdu":"\u2a25","pluse":"\u2a72","plusmn":"\u00b1","plussim":"\u2a26","plustwo":"\u2a27","pm":"\u00b1","pointint":"\u2a15","popf":"\ud835\udd61","pound":"\u00a3","pr":"\u227a","prE":"\u2ab3","prap":"\u2ab7","prcue":"\u227c","pre":"\u2aaf","prec":"\u227a","precapprox":"\u2ab7","preccurlyeq":"\u227c","preceq":"\u2aaf","precnapprox":"\u2ab9","precneqq":"\u2ab5","precnsim":"\u22e8","precsim":"\u227e","prime":"\u2032","primes":"\u2119","prnE":"\u2ab5","prnap":"\u2ab9","prnsim":"\u22e8","prod":"\u220f","profalar":"\u232e","profline":"\u2312","profsurf":"\u2313","prop":"\u221d","propto":"\u221d","prsim":"\u227e","prurel":"\u22b0","pscr":"\ud835\udcc5","psi":"\u03c8","puncsp":"\u2008","qfr":"\ud835\udd2e","qint":"\u2a0c","qopf":"\ud835\udd62","qprime":"\u2057","qscr":"\ud835\udcc6","quaternions":"\u210d","quatint":"\u2a16","quest":"?","questeq":"\u225f","quot":"\"","rAarr":"\u21db","rArr":"\u21d2","rAtail":"\u291c","rBarr":"\u290f","rHar":"\u2964","race":"\u223d\u0331","racute":"\u0155","radic":"\u221a","raemptyv":"\u29b3","rang":"\u27e9","rangd":"\u2992","range":"\u29a5","rangle":"\u27e9","raquo":"\u00bb","rarr":"\u2192","rarrap":"\u2975","rarrb":"\u21e5","rarrbfs":"\u2920","rarrc":"\u2933","rarrfs":"\u291e","rarrhk":"\u21aa","rarrlp":"\u21ac","rarrpl":"\u2945","rarrsim":"\u2974","rarrtl":"\u21a3","rarrw":"\u219d","ratail":"\u291a","ratio":"\u2236","rationals":"\u211a","rbarr":"\u290d","rbbrk":"\u2773","rbrace":"}","rbrack":"]","rbrke":"\u298c","rbrksld":"\u298e","rbrkslu":"\u2990","rcaron":"\u0159","rcedil":"\u0157","rceil":"\u2309","rcub":"}","rcy":"\u0440","rdca":"\u2937","rdldhar":"\u2969","rdquo":"\u201d","rdquor":"\u201d","rdsh":"\u21b3","real":"\u211c","realine":"\u211b","realpart":"\u211c","reals":"\u211d","rect":"\u25ad","reg":"\u00ae","rfisht":"\u297d","rfloor":"\u230b","rfr":"\ud835\udd2f","rhard":"\u21c1","rharu":"\u21c0","rharul":"\u296c","rho":"\u03c1","rhov":"\u03f1","rightarrow":"\u2192","rightarrowtail":"\u21a3","rightharpoondown":"\u21c1","rightharpoonup":"\u21c0","rightleftarrows":"\u21c4","rightleftharpoons":"\u21cc","rightrightarrows":"\u21c9","rightsquigarrow":"\u219d","rightthreetimes":"\u22cc","ring":"\u02da","risingdotseq":"\u2253","rlarr":"\u21c4","rlhar":"\u21cc","rlm":"\u200f","rmoust":"\u23b1","rmoustache":"\u23b1","rnmid":"\u2aee","roang":"\u27ed","roarr":"\u21fe","robrk":"\u27e7","ropar":"\u2986","ropf":"\ud835\udd63","roplus":"\u2a2e","rotimes":"\u2a35","rpar":")","rpargt":"\u2994","rppolint":"\u2a12","rrarr":"\u21c9","rsaquo":"\u203a","rscr":"\ud835\udcc7","rsh":"\u21b1","rsqb":"]","rsquo":"\u2019","rsquor":"\u2019","rthree":"\u22cc","rtimes":"\u22ca","rtri":"\u25b9","rtrie":"\u22b5","rtrif":"\u25b8","rtriltri":"\u29ce","ruluhar":"\u2968","rx":"\u211e","sacute":"\u015b","sbquo":"\u201a","sc":"\u227b","scE":"\u2ab4","scap":"\u2ab8","scaron":"\u0161","sccue":"\u227d","sce":"\u2ab0","scedil":"\u015f","scirc":"\u015d","scnE":"\u2ab6","scnap":"\u2aba","scnsim":"\u22e9","scpolint":"\u2a13","scsim":"\u227f","scy":"\u0441","sdot":"\u22c5","sdotb":"\u22a1","sdote":"\u2a66","seArr":"\u21d8","searhk":"\u2925","searr":"\u2198","searrow":"\u2198","sect":"\u00a7","semi":";","seswar":"\u2929","setminus":"\u2216","setmn":"\u2216","sext":"\u2736","sfr":"\ud835\udd30","sfrown":"\u2322","sharp":"\u266f","shchcy":"\u0449","shcy":"\u0448","shortmid":"\u2223","shortparallel":"\u2225","shy":"\u00ad","sigma":"\u03c3","sigmaf":"\u03c2","sigmav":"\u03c2","sim":"\u223c","simdot":"\u2a6a","sime":"\u2243","simeq":"\u2243","simg":"\u2a9e","simgE":"\u2aa0","siml":"\u2a9d","simlE":"\u2a9f","simne":"\u2246","simplus":"\u2a24","simrarr":"\u2972","slarr":"\u2190","smallsetminus":"\u2216","smashp":"\u2a33","smeparsl":"\u29e4","smid":"\u2223","smile":"\u2323","smt":"\u2aaa","smte":"\u2aac","smtes":"\u2aac\ufe00","softcy":"\u044c","sol":"/","solb":"\u29c4","solbar":"\u233f","sopf":"\ud835\udd64","spades":"\u2660","spadesuit":"\u2660","spar":"\u2225","sqcap":"\u2293","sqcaps":"\u2293\ufe00","sqcup":"\u2294","sqcups":"\u2294\ufe00","sqsub":"\u228f","sqsube":"\u2291","sqsubset":"\u228f","sqsubseteq":"\u2291","sqsup":"\u2290","sqsupe":"\u2292","sqsupset":"\u2290","sqsupseteq":"\u2292","squ":"\u25a1","square":"\u25a1","squarf":"\u25aa","squf":"\u25aa","srarr":"\u2192","sscr":"\ud835\udcc8","ssetmn":"\u2216","ssmile":"\u2323","sstarf":"\u22c6","star":"\u2606","starf":"\u2605","straightepsilon":"\u03f5","straightphi":"\u03d5","strns":"\u00af","sub":"\u2282","subE":"\u2ac5","subdot":"\u2abd","sube":"\u2286","subedot":"\u2ac3","submult":"\u2ac1","subnE":"\u2acb","subne":"\u228a","subplus":"\u2abf","subrarr":"\u2979","subset":"\u2282","subseteq":"\u2286","subseteqq":"\u2ac5","subsetneq":"\u228a","subsetneqq":"\u2acb","subsim":"\u2ac7","subsub":"\u2ad5","subsup":"\u2ad3","succ":"\u227b","succapprox":"\u2ab8","succcurlyeq":"\u227d","succeq":"\u2ab0","succnapprox":"\u2aba","succneqq":"\u2ab6","succnsim":"\u22e9","succsim":"\u227f","sum":"\u2211","sung":"\u266a","sup":"\u2283","sup1":"\u00b9","sup2":"\u00b2","sup3":"\u00b3","supE":"\u2ac6","supdot":"\u2abe","supdsub":"\u2ad8","supe":"\u2287","supedot":"\u2ac4","suphsol":"\u27c9","suphsub":"\u2ad7","suplarr":"\u297b","supmult":"\u2ac2","supnE":"\u2acc","supne":"\u228b","supplus":"\u2ac0","supset":"\u2283","supseteq":"\u2287","supseteqq":"\u2ac6","supsetneq":"\u228b","supsetneqq":"\u2acc","supsim":"\u2ac8","supsub":"\u2ad4","supsup":"\u2ad6","swArr":"\u21d9","swarhk":"\u2926","swarr":"\u2199","swarrow":"\u2199","swnwar":"\u292a","szlig":"\u00df","target":"\u2316","tau":"\u03c4","tbrk":"\u23b4","tcaron":"\u0165","tcedil":"\u0163","tcy":"\u0442","tdot":"\u20db","telrec":"\u2315","tfr":"\ud835\udd31","there4":"\u2234","therefore":"\u2234","theta":"\u03b8","thetasym":"\u03d1","thetav":"\u03d1","thickapprox":"\u2248","thicksim":"\u223c","thinsp":"\u2009","thkap":"\u2248","thksim":"\u223c","thorn":"\u00fe","tilde":"\u02dc","times":"\u00d7","timesb":"\u22a0","timesbar":"\u2a31","timesd":"\u2a30","tint":"\u222d","toea":"\u2928","top":"\u22a4","topbot":"\u2336","topcir":"\u2af1","topf":"\ud835\udd65","topfork":"\u2ada","tosa":"\u2929","tprime":"\u2034","trade":"\u2122","triangle":"\u25b5","triangledown":"\u25bf","triangleleft":"\u25c3","trianglelefteq":"\u22b4","triangleq":"\u225c","triangleright":"\u25b9","trianglerighteq":"\u22b5","tridot":"\u25ec","trie":"\u225c","triminus":"\u2a3a","triplus":"\u2a39","trisb":"\u29cd","tritime":"\u2a3b","trpezium":"\u23e2","tscr":"\ud835\udcc9","tscy":"\u0446","tshcy":"\u045b","tstrok":"\u0167","twixt":"\u226c","twoheadleftarrow":"\u219e","twoheadrightarrow":"\u21a0","uArr":"\u21d1","uHar":"\u2963","uacute":"\u00fa","uarr":"\u2191","ubrcy":"\u045e","ubreve":"\u016d","ucirc":"\u00fb","ucy":"\u0443","udarr":"\u21c5","udblac":"\u0171","udhar":"\u296e","ufisht":"\u297e","ufr":"\ud835\udd32","ugrave":"\u00f9","uharl":"\u21bf","uharr":"\u21be","uhblk":"\u2580","ulcorn":"\u231c","ulcorner":"\u231c","ulcrop":"\u230f","ultri":"\u25f8","umacr":"\u016b","uml":"\u00a8","uogon":"\u0173","uopf":"\ud835\udd66","uparrow":"\u2191","updownarrow":"\u2195","upharpoonleft":"\u21bf","upharpoonright":"\u21be","uplus":"\u228e","upsi":"\u03c5","upsih":"\u03d2","upsilon":"\u03c5","upuparrows":"\u21c8","urcorn":"\u231d","urcorner":"\u231d","urcrop":"\u230e","uring":"\u016f","urtri":"\u25f9","uscr":"\ud835\udcca","utdot":"\u22f0","utilde":"\u0169","utri":"\u25b5","utrif":"\u25b4","uuarr":"\u21c8","uuml":"\u00fc","uwangle":"\u29a7","vArr":"\u21d5","vBar":"\u2ae8","vBarv":"\u2ae9","vDash":"\u22a8","vangrt":"\u299c","varepsilon":"\u03f5","varkappa":"\u03f0","varnothing":"\u2205","varphi":"\u03d5","varpi":"\u03d6","varpropto":"\u221d","varr":"\u2195","varrho":"\u03f1","varsigma":"\u03c2","varsubsetneq":"\u228a\ufe00","varsubsetneqq":"\u2acb\ufe00","varsupsetneq":"\u228b\ufe00","varsupsetneqq":"\u2acc\ufe00","vartheta":"\u03d1","vartriangleleft":"\u22b2","vartriangleright":"\u22b3","vcy":"\u0432","vdash":"\u22a2","vee":"\u2228","veebar":"\u22bb","veeeq":"\u225a","vellip":"\u22ee","verbar":"|","vert":"|","vfr":"\ud835\udd33","vltri":"\u22b2","vnsub":"\u2282\u20d2","vnsup":"\u2283\u20d2","vopf":"\ud835\udd67","vprop":"\u221d","vrtri":"\u22b3","vscr":"\ud835\udccb","vsubnE":"\u2acb\ufe00","vsubne":"\u228a\ufe00","vsupnE":"\u2acc\ufe00","vsupne":"\u228b\ufe00","vzigzag":"\u299a","wcirc":"\u0175","wedbar":"\u2a5f","wedge":"\u2227","wedgeq":"\u2259","weierp":"\u2118","wfr":"\ud835\udd34","wopf":"\ud835\udd68","wp":"\u2118","wr":"\u2240","wreath":"\u2240","wscr":"\ud835\udccc","xcap":"\u22c2","xcirc":"\u25ef","xcup":"\u22c3","xdtri":"\u25bd","xfr":"\ud835\udd35","xhArr":"\u27fa","xharr":"\u27f7","xi":"\u03be","xlArr":"\u27f8","xlarr":"\u27f5","xmap":"\u27fc","xnis":"\u22fb","xodot":"\u2a00","xopf":"\ud835\udd69","xoplus":"\u2a01","xotime":"\u2a02","xrArr":"\u27f9","xrarr":"\u27f6","xscr":"\ud835\udccd","xsqcup":"\u2a06","xuplus":"\u2a04","xutri":"\u25b3","xvee":"\u22c1","xwedge":"\u22c0","yacute":"\u00fd","yacy":"\u044f","ycirc":"\u0177","ycy":"\u044b","yen":"\u00a5","yfr":"\ud835\udd36","yicy":"\u0457","yopf":"\ud835\udd6a","yscr":"\ud835\udcce","yucy":"\u044e","yuml":"\u00ff","zacute":"\u017a","zcaron":"\u017e","zcy":"\u0437","zdot":"\u017c","zeetrf":"\u2128","zeta":"\u03b6","zfr":"\ud835\udd37","zhcy":"\u0436","zigrarr":"\u21dd","zopf":"\ud835\udd6b","zscr":"\ud835\udccf","zwj":"\u200d","zwnj":"\u200c"};
  const HTML_NUMERIC_REPLACEMENTS = {"128":"\u20ac","130":"\u201a","131":"\u0192","132":"\u201e","133":"\u2026","134":"\u2020","135":"\u2021","136":"\u02c6","137":"\u2030","138":"\u0160","139":"\u2039","140":"\u0152","142":"\u017d","145":"\u2018","146":"\u2019","147":"\u201c","148":"\u201d","149":"\u2022","150":"\u2013","151":"\u2014","152":"\u02dc","153":"\u2122","154":"\u0161","155":"\u203a","156":"\u0153","158":"\u017e","159":"\u0178"};
  // END generated HTML character references

  function linkValue(raw) {
    return raw.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])|&(?:#([xX][0-9a-fA-F]{1,6}|[0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]+));/g, (whole, escaped, number, name) => {
        if (escaped) return escaped;
        if (name) return Object.prototype.hasOwnProperty.call(HTML_CHARACTER_REFERENCES, name) ? HTML_CHARACTER_REFERENCES[name] : whole;
        const value = /^x/i.test(number) ? parseInt(number.slice(1), 16) : Number(number);
        if (Object.prototype.hasOwnProperty.call(HTML_NUMERIC_REPLACEMENTS, value)) return HTML_NUMERIC_REPLACEMENTS[value];
        return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : "\ufffd";
      });
  }

  function linkDestinationAt(source, opening, end = source.length) {
    if (source[opening] !== "(") return null;
    let cursor = opening + 1;
    let invalidWhitespace = false;
    const whitespace = () => {
      const before = cursor;
      while (cursor < end && /[ \t\r\n]/.test(source[cursor])) cursor++;
      const gap = source.slice(before, cursor).replace(/\r\n|\r/g, "\n");
      if ((gap.match(/\n/g) || []).length > 1) invalidWhitespace = true;
      return cursor > before;
    };
    whitespace();
    let from = cursor, to;
    if (source[cursor] === "<") {
      from = ++cursor;
      while (cursor < end && source[cursor] !== ">") {
        if (source[cursor] === "\\" && ESCAPABLE.test(source[cursor + 1] || "")) { cursor += 2; continue; }
        if (source[cursor] === "<" || /[\r\n]/.test(source[cursor])) return null;
        cursor++;
      }
      if (cursor >= end) return null;
      to = cursor++;
    } else {
      let parentheses = 0;
      while (cursor < end) {
        const char = source[cursor];
        if (char === "\\" && ESCAPABLE.test(source[cursor + 1] || "")) { cursor += 2; continue; }
        if (char === ")" && parentheses === 0) break;
        if (/[\u0000-\u0020\u007f<>]/.test(char)) break;
        if (char === "(") parentheses++;
        if (char === ")") parentheses--;
        cursor++;
      }
      if (parentheses !== 0) return null;
      to = cursor;
    }
    const gap = whitespace();
    let title = null;
    if (gap && /["'(]/.test(source[cursor] || "")) {
      const delimiter = source[cursor++], closing = delimiter === "(" ? ")" : delimiter;
      const titleStart = cursor;
      while (cursor < end && source[cursor] !== closing) {
        if (source[cursor] === "\\" && ESCAPABLE.test(source[cursor + 1] || "")) { cursor += 2; continue; }
        if (delimiter === "(" && source[cursor] === "(") return null;
        cursor++;
      }
      if (cursor >= end) return null;
      const rawTitle = source.slice(titleStart, cursor++);
      if (/\n[ \t]*\n/.test(rawTitle.replace(/\r\n|\r/g, "\n"))) return null;
      title = linkValue(rawTitle);
      whitespace();
    }
    if (invalidWhitespace || cursor >= end || source[cursor] !== ")") return null;
    return {href: linkValue(source.slice(from, to)), title, end: cursor + 1};
  }

  // Unicode default case folding; generated from Python str.casefold.
  const REFERENCE_CASE_FOLD = {"A":"a","B":"b","C":"c","D":"d","E":"e","F":"f","G":"g","H":"h","I":"i","J":"j","K":"k","L":"l","M":"m","N":"n","O":"o","P":"p","Q":"q","R":"r","S":"s","T":"t","U":"u","V":"v","W":"w","X":"x","Y":"y","Z":"z","\u00b5":"\u03bc","\u00c0":"\u00e0","\u00c1":"\u00e1","\u00c2":"\u00e2","\u00c3":"\u00e3","\u00c4":"\u00e4","\u00c5":"\u00e5","\u00c6":"\u00e6","\u00c7":"\u00e7","\u00c8":"\u00e8","\u00c9":"\u00e9","\u00ca":"\u00ea","\u00cb":"\u00eb","\u00cc":"\u00ec","\u00cd":"\u00ed","\u00ce":"\u00ee","\u00cf":"\u00ef","\u00d0":"\u00f0","\u00d1":"\u00f1","\u00d2":"\u00f2","\u00d3":"\u00f3","\u00d4":"\u00f4","\u00d5":"\u00f5","\u00d6":"\u00f6","\u00d8":"\u00f8","\u00d9":"\u00f9","\u00da":"\u00fa","\u00db":"\u00fb","\u00dc":"\u00fc","\u00dd":"\u00fd","\u00de":"\u00fe","\u00df":"ss","\u0100":"\u0101","\u0102":"\u0103","\u0104":"\u0105","\u0106":"\u0107","\u0108":"\u0109","\u010a":"\u010b","\u010c":"\u010d","\u010e":"\u010f","\u0110":"\u0111","\u0112":"\u0113","\u0114":"\u0115","\u0116":"\u0117","\u0118":"\u0119","\u011a":"\u011b","\u011c":"\u011d","\u011e":"\u011f","\u0120":"\u0121","\u0122":"\u0123","\u0124":"\u0125","\u0126":"\u0127","\u0128":"\u0129","\u012a":"\u012b","\u012c":"\u012d","\u012e":"\u012f","\u0130":"i\u0307","\u0132":"\u0133","\u0134":"\u0135","\u0136":"\u0137","\u0139":"\u013a","\u013b":"\u013c","\u013d":"\u013e","\u013f":"\u0140","\u0141":"\u0142","\u0143":"\u0144","\u0145":"\u0146","\u0147":"\u0148","\u0149":"\u02bcn","\u014a":"\u014b","\u014c":"\u014d","\u014e":"\u014f","\u0150":"\u0151","\u0152":"\u0153","\u0154":"\u0155","\u0156":"\u0157","\u0158":"\u0159","\u015a":"\u015b","\u015c":"\u015d","\u015e":"\u015f","\u0160":"\u0161","\u0162":"\u0163","\u0164":"\u0165","\u0166":"\u0167","\u0168":"\u0169","\u016a":"\u016b","\u016c":"\u016d","\u016e":"\u016f","\u0170":"\u0171","\u0172":"\u0173","\u0174":"\u0175","\u0176":"\u0177","\u0178":"\u00ff","\u0179":"\u017a","\u017b":"\u017c","\u017d":"\u017e","\u017f":"s","\u0181":"\u0253","\u0182":"\u0183","\u0184":"\u0185","\u0186":"\u0254","\u0187":"\u0188","\u0189":"\u0256","\u018a":"\u0257","\u018b":"\u018c","\u018e":"\u01dd","\u018f":"\u0259","\u0190":"\u025b","\u0191":"\u0192","\u0193":"\u0260","\u0194":"\u0263","\u0196":"\u0269","\u0197":"\u0268","\u0198":"\u0199","\u019c":"\u026f","\u019d":"\u0272","\u019f":"\u0275","\u01a0":"\u01a1","\u01a2":"\u01a3","\u01a4":"\u01a5","\u01a6":"\u0280","\u01a7":"\u01a8","\u01a9":"\u0283","\u01ac":"\u01ad","\u01ae":"\u0288","\u01af":"\u01b0","\u01b1":"\u028a","\u01b2":"\u028b","\u01b3":"\u01b4","\u01b5":"\u01b6","\u01b7":"\u0292","\u01b8":"\u01b9","\u01bc":"\u01bd","\u01c4":"\u01c6","\u01c5":"\u01c6","\u01c7":"\u01c9","\u01c8":"\u01c9","\u01ca":"\u01cc","\u01cb":"\u01cc","\u01cd":"\u01ce","\u01cf":"\u01d0","\u01d1":"\u01d2","\u01d3":"\u01d4","\u01d5":"\u01d6","\u01d7":"\u01d8","\u01d9":"\u01da","\u01db":"\u01dc","\u01de":"\u01df","\u01e0":"\u01e1","\u01e2":"\u01e3","\u01e4":"\u01e5","\u01e6":"\u01e7","\u01e8":"\u01e9","\u01ea":"\u01eb","\u01ec":"\u01ed","\u01ee":"\u01ef","\u01f0":"j\u030c","\u01f1":"\u01f3","\u01f2":"\u01f3","\u01f4":"\u01f5","\u01f6":"\u0195","\u01f7":"\u01bf","\u01f8":"\u01f9","\u01fa":"\u01fb","\u01fc":"\u01fd","\u01fe":"\u01ff","\u0200":"\u0201","\u0202":"\u0203","\u0204":"\u0205","\u0206":"\u0207","\u0208":"\u0209","\u020a":"\u020b","\u020c":"\u020d","\u020e":"\u020f","\u0210":"\u0211","\u0212":"\u0213","\u0214":"\u0215","\u0216":"\u0217","\u0218":"\u0219","\u021a":"\u021b","\u021c":"\u021d","\u021e":"\u021f","\u0220":"\u019e","\u0222":"\u0223","\u0224":"\u0225","\u0226":"\u0227","\u0228":"\u0229","\u022a":"\u022b","\u022c":"\u022d","\u022e":"\u022f","\u0230":"\u0231","\u0232":"\u0233","\u023a":"\u2c65","\u023b":"\u023c","\u023d":"\u019a","\u023e":"\u2c66","\u0241":"\u0242","\u0243":"\u0180","\u0244":"\u0289","\u0245":"\u028c","\u0246":"\u0247","\u0248":"\u0249","\u024a":"\u024b","\u024c":"\u024d","\u024e":"\u024f","\u0345":"\u03b9","\u0370":"\u0371","\u0372":"\u0373","\u0376":"\u0377","\u037f":"\u03f3","\u0386":"\u03ac","\u0388":"\u03ad","\u0389":"\u03ae","\u038a":"\u03af","\u038c":"\u03cc","\u038e":"\u03cd","\u038f":"\u03ce","\u0390":"\u03b9\u0308\u0301","\u0391":"\u03b1","\u0392":"\u03b2","\u0393":"\u03b3","\u0394":"\u03b4","\u0395":"\u03b5","\u0396":"\u03b6","\u0397":"\u03b7","\u0398":"\u03b8","\u0399":"\u03b9","\u039a":"\u03ba","\u039b":"\u03bb","\u039c":"\u03bc","\u039d":"\u03bd","\u039e":"\u03be","\u039f":"\u03bf","\u03a0":"\u03c0","\u03a1":"\u03c1","\u03a3":"\u03c3","\u03a4":"\u03c4","\u03a5":"\u03c5","\u03a6":"\u03c6","\u03a7":"\u03c7","\u03a8":"\u03c8","\u03a9":"\u03c9","\u03aa":"\u03ca","\u03ab":"\u03cb","\u03b0":"\u03c5\u0308\u0301","\u03c2":"\u03c3","\u03cf":"\u03d7","\u03d0":"\u03b2","\u03d1":"\u03b8","\u03d5":"\u03c6","\u03d6":"\u03c0","\u03d8":"\u03d9","\u03da":"\u03db","\u03dc":"\u03dd","\u03de":"\u03df","\u03e0":"\u03e1","\u03e2":"\u03e3","\u03e4":"\u03e5","\u03e6":"\u03e7","\u03e8":"\u03e9","\u03ea":"\u03eb","\u03ec":"\u03ed","\u03ee":"\u03ef","\u03f0":"\u03ba","\u03f1":"\u03c1","\u03f4":"\u03b8","\u03f5":"\u03b5","\u03f7":"\u03f8","\u03f9":"\u03f2","\u03fa":"\u03fb","\u03fd":"\u037b","\u03fe":"\u037c","\u03ff":"\u037d","\u0400":"\u0450","\u0401":"\u0451","\u0402":"\u0452","\u0403":"\u0453","\u0404":"\u0454","\u0405":"\u0455","\u0406":"\u0456","\u0407":"\u0457","\u0408":"\u0458","\u0409":"\u0459","\u040a":"\u045a","\u040b":"\u045b","\u040c":"\u045c","\u040d":"\u045d","\u040e":"\u045e","\u040f":"\u045f","\u0410":"\u0430","\u0411":"\u0431","\u0412":"\u0432","\u0413":"\u0433","\u0414":"\u0434","\u0415":"\u0435","\u0416":"\u0436","\u0417":"\u0437","\u0418":"\u0438","\u0419":"\u0439","\u041a":"\u043a","\u041b":"\u043b","\u041c":"\u043c","\u041d":"\u043d","\u041e":"\u043e","\u041f":"\u043f","\u0420":"\u0440","\u0421":"\u0441","\u0422":"\u0442","\u0423":"\u0443","\u0424":"\u0444","\u0425":"\u0445","\u0426":"\u0446","\u0427":"\u0447","\u0428":"\u0448","\u0429":"\u0449","\u042a":"\u044a","\u042b":"\u044b","\u042c":"\u044c","\u042d":"\u044d","\u042e":"\u044e","\u042f":"\u044f","\u0460":"\u0461","\u0462":"\u0463","\u0464":"\u0465","\u0466":"\u0467","\u0468":"\u0469","\u046a":"\u046b","\u046c":"\u046d","\u046e":"\u046f","\u0470":"\u0471","\u0472":"\u0473","\u0474":"\u0475","\u0476":"\u0477","\u0478":"\u0479","\u047a":"\u047b","\u047c":"\u047d","\u047e":"\u047f","\u0480":"\u0481","\u048a":"\u048b","\u048c":"\u048d","\u048e":"\u048f","\u0490":"\u0491","\u0492":"\u0493","\u0494":"\u0495","\u0496":"\u0497","\u0498":"\u0499","\u049a":"\u049b","\u049c":"\u049d","\u049e":"\u049f","\u04a0":"\u04a1","\u04a2":"\u04a3","\u04a4":"\u04a5","\u04a6":"\u04a7","\u04a8":"\u04a9","\u04aa":"\u04ab","\u04ac":"\u04ad","\u04ae":"\u04af","\u04b0":"\u04b1","\u04b2":"\u04b3","\u04b4":"\u04b5","\u04b6":"\u04b7","\u04b8":"\u04b9","\u04ba":"\u04bb","\u04bc":"\u04bd","\u04be":"\u04bf","\u04c0":"\u04cf","\u04c1":"\u04c2","\u04c3":"\u04c4","\u04c5":"\u04c6","\u04c7":"\u04c8","\u04c9":"\u04ca","\u04cb":"\u04cc","\u04cd":"\u04ce","\u04d0":"\u04d1","\u04d2":"\u04d3","\u04d4":"\u04d5","\u04d6":"\u04d7","\u04d8":"\u04d9","\u04da":"\u04db","\u04dc":"\u04dd","\u04de":"\u04df","\u04e0":"\u04e1","\u04e2":"\u04e3","\u04e4":"\u04e5","\u04e6":"\u04e7","\u04e8":"\u04e9","\u04ea":"\u04eb","\u04ec":"\u04ed","\u04ee":"\u04ef","\u04f0":"\u04f1","\u04f2":"\u04f3","\u04f4":"\u04f5","\u04f6":"\u04f7","\u04f8":"\u04f9","\u04fa":"\u04fb","\u04fc":"\u04fd","\u04fe":"\u04ff","\u0500":"\u0501","\u0502":"\u0503","\u0504":"\u0505","\u0506":"\u0507","\u0508":"\u0509","\u050a":"\u050b","\u050c":"\u050d","\u050e":"\u050f","\u0510":"\u0511","\u0512":"\u0513","\u0514":"\u0515","\u0516":"\u0517","\u0518":"\u0519","\u051a":"\u051b","\u051c":"\u051d","\u051e":"\u051f","\u0520":"\u0521","\u0522":"\u0523","\u0524":"\u0525","\u0526":"\u0527","\u0528":"\u0529","\u052a":"\u052b","\u052c":"\u052d","\u052e":"\u052f","\u0531":"\u0561","\u0532":"\u0562","\u0533":"\u0563","\u0534":"\u0564","\u0535":"\u0565","\u0536":"\u0566","\u0537":"\u0567","\u0538":"\u0568","\u0539":"\u0569","\u053a":"\u056a","\u053b":"\u056b","\u053c":"\u056c","\u053d":"\u056d","\u053e":"\u056e","\u053f":"\u056f","\u0540":"\u0570","\u0541":"\u0571","\u0542":"\u0572","\u0543":"\u0573","\u0544":"\u0574","\u0545":"\u0575","\u0546":"\u0576","\u0547":"\u0577","\u0548":"\u0578","\u0549":"\u0579","\u054a":"\u057a","\u054b":"\u057b","\u054c":"\u057c","\u054d":"\u057d","\u054e":"\u057e","\u054f":"\u057f","\u0550":"\u0580","\u0551":"\u0581","\u0552":"\u0582","\u0553":"\u0583","\u0554":"\u0584","\u0555":"\u0585","\u0556":"\u0586","\u0587":"\u0565\u0582","\u10a0":"\u2d00","\u10a1":"\u2d01","\u10a2":"\u2d02","\u10a3":"\u2d03","\u10a4":"\u2d04","\u10a5":"\u2d05","\u10a6":"\u2d06","\u10a7":"\u2d07","\u10a8":"\u2d08","\u10a9":"\u2d09","\u10aa":"\u2d0a","\u10ab":"\u2d0b","\u10ac":"\u2d0c","\u10ad":"\u2d0d","\u10ae":"\u2d0e","\u10af":"\u2d0f","\u10b0":"\u2d10","\u10b1":"\u2d11","\u10b2":"\u2d12","\u10b3":"\u2d13","\u10b4":"\u2d14","\u10b5":"\u2d15","\u10b6":"\u2d16","\u10b7":"\u2d17","\u10b8":"\u2d18","\u10b9":"\u2d19","\u10ba":"\u2d1a","\u10bb":"\u2d1b","\u10bc":"\u2d1c","\u10bd":"\u2d1d","\u10be":"\u2d1e","\u10bf":"\u2d1f","\u10c0":"\u2d20","\u10c1":"\u2d21","\u10c2":"\u2d22","\u10c3":"\u2d23","\u10c4":"\u2d24","\u10c5":"\u2d25","\u10c7":"\u2d27","\u10cd":"\u2d2d","\u13f8":"\u13f0","\u13f9":"\u13f1","\u13fa":"\u13f2","\u13fb":"\u13f3","\u13fc":"\u13f4","\u13fd":"\u13f5","\u1c80":"\u0432","\u1c81":"\u0434","\u1c82":"\u043e","\u1c83":"\u0441","\u1c84":"\u0442","\u1c85":"\u0442","\u1c86":"\u044a","\u1c87":"\u0463","\u1c88":"\ua64b","\u1c89":"\u1c8a","\u1c90":"\u10d0","\u1c91":"\u10d1","\u1c92":"\u10d2","\u1c93":"\u10d3","\u1c94":"\u10d4","\u1c95":"\u10d5","\u1c96":"\u10d6","\u1c97":"\u10d7","\u1c98":"\u10d8","\u1c99":"\u10d9","\u1c9a":"\u10da","\u1c9b":"\u10db","\u1c9c":"\u10dc","\u1c9d":"\u10dd","\u1c9e":"\u10de","\u1c9f":"\u10df","\u1ca0":"\u10e0","\u1ca1":"\u10e1","\u1ca2":"\u10e2","\u1ca3":"\u10e3","\u1ca4":"\u10e4","\u1ca5":"\u10e5","\u1ca6":"\u10e6","\u1ca7":"\u10e7","\u1ca8":"\u10e8","\u1ca9":"\u10e9","\u1caa":"\u10ea","\u1cab":"\u10eb","\u1cac":"\u10ec","\u1cad":"\u10ed","\u1cae":"\u10ee","\u1caf":"\u10ef","\u1cb0":"\u10f0","\u1cb1":"\u10f1","\u1cb2":"\u10f2","\u1cb3":"\u10f3","\u1cb4":"\u10f4","\u1cb5":"\u10f5","\u1cb6":"\u10f6","\u1cb7":"\u10f7","\u1cb8":"\u10f8","\u1cb9":"\u10f9","\u1cba":"\u10fa","\u1cbd":"\u10fd","\u1cbe":"\u10fe","\u1cbf":"\u10ff","\u1e00":"\u1e01","\u1e02":"\u1e03","\u1e04":"\u1e05","\u1e06":"\u1e07","\u1e08":"\u1e09","\u1e0a":"\u1e0b","\u1e0c":"\u1e0d","\u1e0e":"\u1e0f","\u1e10":"\u1e11","\u1e12":"\u1e13","\u1e14":"\u1e15","\u1e16":"\u1e17","\u1e18":"\u1e19","\u1e1a":"\u1e1b","\u1e1c":"\u1e1d","\u1e1e":"\u1e1f","\u1e20":"\u1e21","\u1e22":"\u1e23","\u1e24":"\u1e25","\u1e26":"\u1e27","\u1e28":"\u1e29","\u1e2a":"\u1e2b","\u1e2c":"\u1e2d","\u1e2e":"\u1e2f","\u1e30":"\u1e31","\u1e32":"\u1e33","\u1e34":"\u1e35","\u1e36":"\u1e37","\u1e38":"\u1e39","\u1e3a":"\u1e3b","\u1e3c":"\u1e3d","\u1e3e":"\u1e3f","\u1e40":"\u1e41","\u1e42":"\u1e43","\u1e44":"\u1e45","\u1e46":"\u1e47","\u1e48":"\u1e49","\u1e4a":"\u1e4b","\u1e4c":"\u1e4d","\u1e4e":"\u1e4f","\u1e50":"\u1e51","\u1e52":"\u1e53","\u1e54":"\u1e55","\u1e56":"\u1e57","\u1e58":"\u1e59","\u1e5a":"\u1e5b","\u1e5c":"\u1e5d","\u1e5e":"\u1e5f","\u1e60":"\u1e61","\u1e62":"\u1e63","\u1e64":"\u1e65","\u1e66":"\u1e67","\u1e68":"\u1e69","\u1e6a":"\u1e6b","\u1e6c":"\u1e6d","\u1e6e":"\u1e6f","\u1e70":"\u1e71","\u1e72":"\u1e73","\u1e74":"\u1e75","\u1e76":"\u1e77","\u1e78":"\u1e79","\u1e7a":"\u1e7b","\u1e7c":"\u1e7d","\u1e7e":"\u1e7f","\u1e80":"\u1e81","\u1e82":"\u1e83","\u1e84":"\u1e85","\u1e86":"\u1e87","\u1e88":"\u1e89","\u1e8a":"\u1e8b","\u1e8c":"\u1e8d","\u1e8e":"\u1e8f","\u1e90":"\u1e91","\u1e92":"\u1e93","\u1e94":"\u1e95","\u1e96":"h\u0331","\u1e97":"t\u0308","\u1e98":"w\u030a","\u1e99":"y\u030a","\u1e9a":"a\u02be","\u1e9b":"\u1e61","\u1e9e":"ss","\u1ea0":"\u1ea1","\u1ea2":"\u1ea3","\u1ea4":"\u1ea5","\u1ea6":"\u1ea7","\u1ea8":"\u1ea9","\u1eaa":"\u1eab","\u1eac":"\u1ead","\u1eae":"\u1eaf","\u1eb0":"\u1eb1","\u1eb2":"\u1eb3","\u1eb4":"\u1eb5","\u1eb6":"\u1eb7","\u1eb8":"\u1eb9","\u1eba":"\u1ebb","\u1ebc":"\u1ebd","\u1ebe":"\u1ebf","\u1ec0":"\u1ec1","\u1ec2":"\u1ec3","\u1ec4":"\u1ec5","\u1ec6":"\u1ec7","\u1ec8":"\u1ec9","\u1eca":"\u1ecb","\u1ecc":"\u1ecd","\u1ece":"\u1ecf","\u1ed0":"\u1ed1","\u1ed2":"\u1ed3","\u1ed4":"\u1ed5","\u1ed6":"\u1ed7","\u1ed8":"\u1ed9","\u1eda":"\u1edb","\u1edc":"\u1edd","\u1ede":"\u1edf","\u1ee0":"\u1ee1","\u1ee2":"\u1ee3","\u1ee4":"\u1ee5","\u1ee6":"\u1ee7","\u1ee8":"\u1ee9","\u1eea":"\u1eeb","\u1eec":"\u1eed","\u1eee":"\u1eef","\u1ef0":"\u1ef1","\u1ef2":"\u1ef3","\u1ef4":"\u1ef5","\u1ef6":"\u1ef7","\u1ef8":"\u1ef9","\u1efa":"\u1efb","\u1efc":"\u1efd","\u1efe":"\u1eff","\u1f08":"\u1f00","\u1f09":"\u1f01","\u1f0a":"\u1f02","\u1f0b":"\u1f03","\u1f0c":"\u1f04","\u1f0d":"\u1f05","\u1f0e":"\u1f06","\u1f0f":"\u1f07","\u1f18":"\u1f10","\u1f19":"\u1f11","\u1f1a":"\u1f12","\u1f1b":"\u1f13","\u1f1c":"\u1f14","\u1f1d":"\u1f15","\u1f28":"\u1f20","\u1f29":"\u1f21","\u1f2a":"\u1f22","\u1f2b":"\u1f23","\u1f2c":"\u1f24","\u1f2d":"\u1f25","\u1f2e":"\u1f26","\u1f2f":"\u1f27","\u1f38":"\u1f30","\u1f39":"\u1f31","\u1f3a":"\u1f32","\u1f3b":"\u1f33","\u1f3c":"\u1f34","\u1f3d":"\u1f35","\u1f3e":"\u1f36","\u1f3f":"\u1f37","\u1f48":"\u1f40","\u1f49":"\u1f41","\u1f4a":"\u1f42","\u1f4b":"\u1f43","\u1f4c":"\u1f44","\u1f4d":"\u1f45","\u1f50":"\u03c5\u0313","\u1f52":"\u03c5\u0313\u0300","\u1f54":"\u03c5\u0313\u0301","\u1f56":"\u03c5\u0313\u0342","\u1f59":"\u1f51","\u1f5b":"\u1f53","\u1f5d":"\u1f55","\u1f5f":"\u1f57","\u1f68":"\u1f60","\u1f69":"\u1f61","\u1f6a":"\u1f62","\u1f6b":"\u1f63","\u1f6c":"\u1f64","\u1f6d":"\u1f65","\u1f6e":"\u1f66","\u1f6f":"\u1f67","\u1f80":"\u1f00\u03b9","\u1f81":"\u1f01\u03b9","\u1f82":"\u1f02\u03b9","\u1f83":"\u1f03\u03b9","\u1f84":"\u1f04\u03b9","\u1f85":"\u1f05\u03b9","\u1f86":"\u1f06\u03b9","\u1f87":"\u1f07\u03b9","\u1f88":"\u1f00\u03b9","\u1f89":"\u1f01\u03b9","\u1f8a":"\u1f02\u03b9","\u1f8b":"\u1f03\u03b9","\u1f8c":"\u1f04\u03b9","\u1f8d":"\u1f05\u03b9","\u1f8e":"\u1f06\u03b9","\u1f8f":"\u1f07\u03b9","\u1f90":"\u1f20\u03b9","\u1f91":"\u1f21\u03b9","\u1f92":"\u1f22\u03b9","\u1f93":"\u1f23\u03b9","\u1f94":"\u1f24\u03b9","\u1f95":"\u1f25\u03b9","\u1f96":"\u1f26\u03b9","\u1f97":"\u1f27\u03b9","\u1f98":"\u1f20\u03b9","\u1f99":"\u1f21\u03b9","\u1f9a":"\u1f22\u03b9","\u1f9b":"\u1f23\u03b9","\u1f9c":"\u1f24\u03b9","\u1f9d":"\u1f25\u03b9","\u1f9e":"\u1f26\u03b9","\u1f9f":"\u1f27\u03b9","\u1fa0":"\u1f60\u03b9","\u1fa1":"\u1f61\u03b9","\u1fa2":"\u1f62\u03b9","\u1fa3":"\u1f63\u03b9","\u1fa4":"\u1f64\u03b9","\u1fa5":"\u1f65\u03b9","\u1fa6":"\u1f66\u03b9","\u1fa7":"\u1f67\u03b9","\u1fa8":"\u1f60\u03b9","\u1fa9":"\u1f61\u03b9","\u1faa":"\u1f62\u03b9","\u1fab":"\u1f63\u03b9","\u1fac":"\u1f64\u03b9","\u1fad":"\u1f65\u03b9","\u1fae":"\u1f66\u03b9","\u1faf":"\u1f67\u03b9","\u1fb2":"\u1f70\u03b9","\u1fb3":"\u03b1\u03b9","\u1fb4":"\u03ac\u03b9","\u1fb6":"\u03b1\u0342","\u1fb7":"\u03b1\u0342\u03b9","\u1fb8":"\u1fb0","\u1fb9":"\u1fb1","\u1fba":"\u1f70","\u1fbb":"\u1f71","\u1fbc":"\u03b1\u03b9","\u1fbe":"\u03b9","\u1fc2":"\u1f74\u03b9","\u1fc3":"\u03b7\u03b9","\u1fc4":"\u03ae\u03b9","\u1fc6":"\u03b7\u0342","\u1fc7":"\u03b7\u0342\u03b9","\u1fc8":"\u1f72","\u1fc9":"\u1f73","\u1fca":"\u1f74","\u1fcb":"\u1f75","\u1fcc":"\u03b7\u03b9","\u1fd2":"\u03b9\u0308\u0300","\u1fd3":"\u03b9\u0308\u0301","\u1fd6":"\u03b9\u0342","\u1fd7":"\u03b9\u0308\u0342","\u1fd8":"\u1fd0","\u1fd9":"\u1fd1","\u1fda":"\u1f76","\u1fdb":"\u1f77","\u1fe2":"\u03c5\u0308\u0300","\u1fe3":"\u03c5\u0308\u0301","\u1fe4":"\u03c1\u0313","\u1fe6":"\u03c5\u0342","\u1fe7":"\u03c5\u0308\u0342","\u1fe8":"\u1fe0","\u1fe9":"\u1fe1","\u1fea":"\u1f7a","\u1feb":"\u1f7b","\u1fec":"\u1fe5","\u1ff2":"\u1f7c\u03b9","\u1ff3":"\u03c9\u03b9","\u1ff4":"\u03ce\u03b9","\u1ff6":"\u03c9\u0342","\u1ff7":"\u03c9\u0342\u03b9","\u1ff8":"\u1f78","\u1ff9":"\u1f79","\u1ffa":"\u1f7c","\u1ffb":"\u1f7d","\u1ffc":"\u03c9\u03b9","\u2126":"\u03c9","\u212a":"k","\u212b":"\u00e5","\u2132":"\u214e","\u2160":"\u2170","\u2161":"\u2171","\u2162":"\u2172","\u2163":"\u2173","\u2164":"\u2174","\u2165":"\u2175","\u2166":"\u2176","\u2167":"\u2177","\u2168":"\u2178","\u2169":"\u2179","\u216a":"\u217a","\u216b":"\u217b","\u216c":"\u217c","\u216d":"\u217d","\u216e":"\u217e","\u216f":"\u217f","\u2183":"\u2184","\u24b6":"\u24d0","\u24b7":"\u24d1","\u24b8":"\u24d2","\u24b9":"\u24d3","\u24ba":"\u24d4","\u24bb":"\u24d5","\u24bc":"\u24d6","\u24bd":"\u24d7","\u24be":"\u24d8","\u24bf":"\u24d9","\u24c0":"\u24da","\u24c1":"\u24db","\u24c2":"\u24dc","\u24c3":"\u24dd","\u24c4":"\u24de","\u24c5":"\u24df","\u24c6":"\u24e0","\u24c7":"\u24e1","\u24c8":"\u24e2","\u24c9":"\u24e3","\u24ca":"\u24e4","\u24cb":"\u24e5","\u24cc":"\u24e6","\u24cd":"\u24e7","\u24ce":"\u24e8","\u24cf":"\u24e9","\u2c00":"\u2c30","\u2c01":"\u2c31","\u2c02":"\u2c32","\u2c03":"\u2c33","\u2c04":"\u2c34","\u2c05":"\u2c35","\u2c06":"\u2c36","\u2c07":"\u2c37","\u2c08":"\u2c38","\u2c09":"\u2c39","\u2c0a":"\u2c3a","\u2c0b":"\u2c3b","\u2c0c":"\u2c3c","\u2c0d":"\u2c3d","\u2c0e":"\u2c3e","\u2c0f":"\u2c3f","\u2c10":"\u2c40","\u2c11":"\u2c41","\u2c12":"\u2c42","\u2c13":"\u2c43","\u2c14":"\u2c44","\u2c15":"\u2c45","\u2c16":"\u2c46","\u2c17":"\u2c47","\u2c18":"\u2c48","\u2c19":"\u2c49","\u2c1a":"\u2c4a","\u2c1b":"\u2c4b","\u2c1c":"\u2c4c","\u2c1d":"\u2c4d","\u2c1e":"\u2c4e","\u2c1f":"\u2c4f","\u2c20":"\u2c50","\u2c21":"\u2c51","\u2c22":"\u2c52","\u2c23":"\u2c53","\u2c24":"\u2c54","\u2c25":"\u2c55","\u2c26":"\u2c56","\u2c27":"\u2c57","\u2c28":"\u2c58","\u2c29":"\u2c59","\u2c2a":"\u2c5a","\u2c2b":"\u2c5b","\u2c2c":"\u2c5c","\u2c2d":"\u2c5d","\u2c2e":"\u2c5e","\u2c2f":"\u2c5f","\u2c60":"\u2c61","\u2c62":"\u026b","\u2c63":"\u1d7d","\u2c64":"\u027d","\u2c67":"\u2c68","\u2c69":"\u2c6a","\u2c6b":"\u2c6c","\u2c6d":"\u0251","\u2c6e":"\u0271","\u2c6f":"\u0250","\u2c70":"\u0252","\u2c72":"\u2c73","\u2c75":"\u2c76","\u2c7e":"\u023f","\u2c7f":"\u0240","\u2c80":"\u2c81","\u2c82":"\u2c83","\u2c84":"\u2c85","\u2c86":"\u2c87","\u2c88":"\u2c89","\u2c8a":"\u2c8b","\u2c8c":"\u2c8d","\u2c8e":"\u2c8f","\u2c90":"\u2c91","\u2c92":"\u2c93","\u2c94":"\u2c95","\u2c96":"\u2c97","\u2c98":"\u2c99","\u2c9a":"\u2c9b","\u2c9c":"\u2c9d","\u2c9e":"\u2c9f","\u2ca0":"\u2ca1","\u2ca2":"\u2ca3","\u2ca4":"\u2ca5","\u2ca6":"\u2ca7","\u2ca8":"\u2ca9","\u2caa":"\u2cab","\u2cac":"\u2cad","\u2cae":"\u2caf","\u2cb0":"\u2cb1","\u2cb2":"\u2cb3","\u2cb4":"\u2cb5","\u2cb6":"\u2cb7","\u2cb8":"\u2cb9","\u2cba":"\u2cbb","\u2cbc":"\u2cbd","\u2cbe":"\u2cbf","\u2cc0":"\u2cc1","\u2cc2":"\u2cc3","\u2cc4":"\u2cc5","\u2cc6":"\u2cc7","\u2cc8":"\u2cc9","\u2cca":"\u2ccb","\u2ccc":"\u2ccd","\u2cce":"\u2ccf","\u2cd0":"\u2cd1","\u2cd2":"\u2cd3","\u2cd4":"\u2cd5","\u2cd6":"\u2cd7","\u2cd8":"\u2cd9","\u2cda":"\u2cdb","\u2cdc":"\u2cdd","\u2cde":"\u2cdf","\u2ce0":"\u2ce1","\u2ce2":"\u2ce3","\u2ceb":"\u2cec","\u2ced":"\u2cee","\u2cf2":"\u2cf3","\ua640":"\ua641","\ua642":"\ua643","\ua644":"\ua645","\ua646":"\ua647","\ua648":"\ua649","\ua64a":"\ua64b","\ua64c":"\ua64d","\ua64e":"\ua64f","\ua650":"\ua651","\ua652":"\ua653","\ua654":"\ua655","\ua656":"\ua657","\ua658":"\ua659","\ua65a":"\ua65b","\ua65c":"\ua65d","\ua65e":"\ua65f","\ua660":"\ua661","\ua662":"\ua663","\ua664":"\ua665","\ua666":"\ua667","\ua668":"\ua669","\ua66a":"\ua66b","\ua66c":"\ua66d","\ua680":"\ua681","\ua682":"\ua683","\ua684":"\ua685","\ua686":"\ua687","\ua688":"\ua689","\ua68a":"\ua68b","\ua68c":"\ua68d","\ua68e":"\ua68f","\ua690":"\ua691","\ua692":"\ua693","\ua694":"\ua695","\ua696":"\ua697","\ua698":"\ua699","\ua69a":"\ua69b","\ua722":"\ua723","\ua724":"\ua725","\ua726":"\ua727","\ua728":"\ua729","\ua72a":"\ua72b","\ua72c":"\ua72d","\ua72e":"\ua72f","\ua732":"\ua733","\ua734":"\ua735","\ua736":"\ua737","\ua738":"\ua739","\ua73a":"\ua73b","\ua73c":"\ua73d","\ua73e":"\ua73f","\ua740":"\ua741","\ua742":"\ua743","\ua744":"\ua745","\ua746":"\ua747","\ua748":"\ua749","\ua74a":"\ua74b","\ua74c":"\ua74d","\ua74e":"\ua74f","\ua750":"\ua751","\ua752":"\ua753","\ua754":"\ua755","\ua756":"\ua757","\ua758":"\ua759","\ua75a":"\ua75b","\ua75c":"\ua75d","\ua75e":"\ua75f","\ua760":"\ua761","\ua762":"\ua763","\ua764":"\ua765","\ua766":"\ua767","\ua768":"\ua769","\ua76a":"\ua76b","\ua76c":"\ua76d","\ua76e":"\ua76f","\ua779":"\ua77a","\ua77b":"\ua77c","\ua77d":"\u1d79","\ua77e":"\ua77f","\ua780":"\ua781","\ua782":"\ua783","\ua784":"\ua785","\ua786":"\ua787","\ua78b":"\ua78c","\ua78d":"\u0265","\ua790":"\ua791","\ua792":"\ua793","\ua796":"\ua797","\ua798":"\ua799","\ua79a":"\ua79b","\ua79c":"\ua79d","\ua79e":"\ua79f","\ua7a0":"\ua7a1","\ua7a2":"\ua7a3","\ua7a4":"\ua7a5","\ua7a6":"\ua7a7","\ua7a8":"\ua7a9","\ua7aa":"\u0266","\ua7ab":"\u025c","\ua7ac":"\u0261","\ua7ad":"\u026c","\ua7ae":"\u026a","\ua7b0":"\u029e","\ua7b1":"\u0287","\ua7b2":"\u029d","\ua7b3":"\uab53","\ua7b4":"\ua7b5","\ua7b6":"\ua7b7","\ua7b8":"\ua7b9","\ua7ba":"\ua7bb","\ua7bc":"\ua7bd","\ua7be":"\ua7bf","\ua7c0":"\ua7c1","\ua7c2":"\ua7c3","\ua7c4":"\ua794","\ua7c5":"\u0282","\ua7c6":"\u1d8e","\ua7c7":"\ua7c8","\ua7c9":"\ua7ca","\ua7cb":"\u0264","\ua7cc":"\ua7cd","\ua7d0":"\ua7d1","\ua7d6":"\ua7d7","\ua7d8":"\ua7d9","\ua7da":"\ua7db","\ua7dc":"\u019b","\ua7f5":"\ua7f6","\uab70":"\u13a0","\uab71":"\u13a1","\uab72":"\u13a2","\uab73":"\u13a3","\uab74":"\u13a4","\uab75":"\u13a5","\uab76":"\u13a6","\uab77":"\u13a7","\uab78":"\u13a8","\uab79":"\u13a9","\uab7a":"\u13aa","\uab7b":"\u13ab","\uab7c":"\u13ac","\uab7d":"\u13ad","\uab7e":"\u13ae","\uab7f":"\u13af","\uab80":"\u13b0","\uab81":"\u13b1","\uab82":"\u13b2","\uab83":"\u13b3","\uab84":"\u13b4","\uab85":"\u13b5","\uab86":"\u13b6","\uab87":"\u13b7","\uab88":"\u13b8","\uab89":"\u13b9","\uab8a":"\u13ba","\uab8b":"\u13bb","\uab8c":"\u13bc","\uab8d":"\u13bd","\uab8e":"\u13be","\uab8f":"\u13bf","\uab90":"\u13c0","\uab91":"\u13c1","\uab92":"\u13c2","\uab93":"\u13c3","\uab94":"\u13c4","\uab95":"\u13c5","\uab96":"\u13c6","\uab97":"\u13c7","\uab98":"\u13c8","\uab99":"\u13c9","\uab9a":"\u13ca","\uab9b":"\u13cb","\uab9c":"\u13cc","\uab9d":"\u13cd","\uab9e":"\u13ce","\uab9f":"\u13cf","\uaba0":"\u13d0","\uaba1":"\u13d1","\uaba2":"\u13d2","\uaba3":"\u13d3","\uaba4":"\u13d4","\uaba5":"\u13d5","\uaba6":"\u13d6","\uaba7":"\u13d7","\uaba8":"\u13d8","\uaba9":"\u13d9","\uabaa":"\u13da","\uabab":"\u13db","\uabac":"\u13dc","\uabad":"\u13dd","\uabae":"\u13de","\uabaf":"\u13df","\uabb0":"\u13e0","\uabb1":"\u13e1","\uabb2":"\u13e2","\uabb3":"\u13e3","\uabb4":"\u13e4","\uabb5":"\u13e5","\uabb6":"\u13e6","\uabb7":"\u13e7","\uabb8":"\u13e8","\uabb9":"\u13e9","\uabba":"\u13ea","\uabbb":"\u13eb","\uabbc":"\u13ec","\uabbd":"\u13ed","\uabbe":"\u13ee","\uabbf":"\u13ef","\ufb00":"ff","\ufb01":"fi","\ufb02":"fl","\ufb03":"ffi","\ufb04":"ffl","\ufb05":"st","\ufb06":"st","\ufb13":"\u0574\u0576","\ufb14":"\u0574\u0565","\ufb15":"\u0574\u056b","\ufb16":"\u057e\u0576","\ufb17":"\u0574\u056d","\uff21":"\uff41","\uff22":"\uff42","\uff23":"\uff43","\uff24":"\uff44","\uff25":"\uff45","\uff26":"\uff46","\uff27":"\uff47","\uff28":"\uff48","\uff29":"\uff49","\uff2a":"\uff4a","\uff2b":"\uff4b","\uff2c":"\uff4c","\uff2d":"\uff4d","\uff2e":"\uff4e","\uff2f":"\uff4f","\uff30":"\uff50","\uff31":"\uff51","\uff32":"\uff52","\uff33":"\uff53","\uff34":"\uff54","\uff35":"\uff55","\uff36":"\uff56","\uff37":"\uff57","\uff38":"\uff58","\uff39":"\uff59","\uff3a":"\uff5a","\ud801\udc00":"\ud801\udc28","\ud801\udc01":"\ud801\udc29","\ud801\udc02":"\ud801\udc2a","\ud801\udc03":"\ud801\udc2b","\ud801\udc04":"\ud801\udc2c","\ud801\udc05":"\ud801\udc2d","\ud801\udc06":"\ud801\udc2e","\ud801\udc07":"\ud801\udc2f","\ud801\udc08":"\ud801\udc30","\ud801\udc09":"\ud801\udc31","\ud801\udc0a":"\ud801\udc32","\ud801\udc0b":"\ud801\udc33","\ud801\udc0c":"\ud801\udc34","\ud801\udc0d":"\ud801\udc35","\ud801\udc0e":"\ud801\udc36","\ud801\udc0f":"\ud801\udc37","\ud801\udc10":"\ud801\udc38","\ud801\udc11":"\ud801\udc39","\ud801\udc12":"\ud801\udc3a","\ud801\udc13":"\ud801\udc3b","\ud801\udc14":"\ud801\udc3c","\ud801\udc15":"\ud801\udc3d","\ud801\udc16":"\ud801\udc3e","\ud801\udc17":"\ud801\udc3f","\ud801\udc18":"\ud801\udc40","\ud801\udc19":"\ud801\udc41","\ud801\udc1a":"\ud801\udc42","\ud801\udc1b":"\ud801\udc43","\ud801\udc1c":"\ud801\udc44","\ud801\udc1d":"\ud801\udc45","\ud801\udc1e":"\ud801\udc46","\ud801\udc1f":"\ud801\udc47","\ud801\udc20":"\ud801\udc48","\ud801\udc21":"\ud801\udc49","\ud801\udc22":"\ud801\udc4a","\ud801\udc23":"\ud801\udc4b","\ud801\udc24":"\ud801\udc4c","\ud801\udc25":"\ud801\udc4d","\ud801\udc26":"\ud801\udc4e","\ud801\udc27":"\ud801\udc4f","\ud801\udcb0":"\ud801\udcd8","\ud801\udcb1":"\ud801\udcd9","\ud801\udcb2":"\ud801\udcda","\ud801\udcb3":"\ud801\udcdb","\ud801\udcb4":"\ud801\udcdc","\ud801\udcb5":"\ud801\udcdd","\ud801\udcb6":"\ud801\udcde","\ud801\udcb7":"\ud801\udcdf","\ud801\udcb8":"\ud801\udce0","\ud801\udcb9":"\ud801\udce1","\ud801\udcba":"\ud801\udce2","\ud801\udcbb":"\ud801\udce3","\ud801\udcbc":"\ud801\udce4","\ud801\udcbd":"\ud801\udce5","\ud801\udcbe":"\ud801\udce6","\ud801\udcbf":"\ud801\udce7","\ud801\udcc0":"\ud801\udce8","\ud801\udcc1":"\ud801\udce9","\ud801\udcc2":"\ud801\udcea","\ud801\udcc3":"\ud801\udceb","\ud801\udcc4":"\ud801\udcec","\ud801\udcc5":"\ud801\udced","\ud801\udcc6":"\ud801\udcee","\ud801\udcc7":"\ud801\udcef","\ud801\udcc8":"\ud801\udcf0","\ud801\udcc9":"\ud801\udcf1","\ud801\udcca":"\ud801\udcf2","\ud801\udccb":"\ud801\udcf3","\ud801\udccc":"\ud801\udcf4","\ud801\udccd":"\ud801\udcf5","\ud801\udcce":"\ud801\udcf6","\ud801\udccf":"\ud801\udcf7","\ud801\udcd0":"\ud801\udcf8","\ud801\udcd1":"\ud801\udcf9","\ud801\udcd2":"\ud801\udcfa","\ud801\udcd3":"\ud801\udcfb","\ud801\udd70":"\ud801\udd97","\ud801\udd71":"\ud801\udd98","\ud801\udd72":"\ud801\udd99","\ud801\udd73":"\ud801\udd9a","\ud801\udd74":"\ud801\udd9b","\ud801\udd75":"\ud801\udd9c","\ud801\udd76":"\ud801\udd9d","\ud801\udd77":"\ud801\udd9e","\ud801\udd78":"\ud801\udd9f","\ud801\udd79":"\ud801\udda0","\ud801\udd7a":"\ud801\udda1","\ud801\udd7c":"\ud801\udda3","\ud801\udd7d":"\ud801\udda4","\ud801\udd7e":"\ud801\udda5","\ud801\udd7f":"\ud801\udda6","\ud801\udd80":"\ud801\udda7","\ud801\udd81":"\ud801\udda8","\ud801\udd82":"\ud801\udda9","\ud801\udd83":"\ud801\uddaa","\ud801\udd84":"\ud801\uddab","\ud801\udd85":"\ud801\uddac","\ud801\udd86":"\ud801\uddad","\ud801\udd87":"\ud801\uddae","\ud801\udd88":"\ud801\uddaf","\ud801\udd89":"\ud801\uddb0","\ud801\udd8a":"\ud801\uddb1","\ud801\udd8c":"\ud801\uddb3","\ud801\udd8d":"\ud801\uddb4","\ud801\udd8e":"\ud801\uddb5","\ud801\udd8f":"\ud801\uddb6","\ud801\udd90":"\ud801\uddb7","\ud801\udd91":"\ud801\uddb8","\ud801\udd92":"\ud801\uddb9","\ud801\udd94":"\ud801\uddbb","\ud801\udd95":"\ud801\uddbc","\ud803\udc80":"\ud803\udcc0","\ud803\udc81":"\ud803\udcc1","\ud803\udc82":"\ud803\udcc2","\ud803\udc83":"\ud803\udcc3","\ud803\udc84":"\ud803\udcc4","\ud803\udc85":"\ud803\udcc5","\ud803\udc86":"\ud803\udcc6","\ud803\udc87":"\ud803\udcc7","\ud803\udc88":"\ud803\udcc8","\ud803\udc89":"\ud803\udcc9","\ud803\udc8a":"\ud803\udcca","\ud803\udc8b":"\ud803\udccb","\ud803\udc8c":"\ud803\udccc","\ud803\udc8d":"\ud803\udccd","\ud803\udc8e":"\ud803\udcce","\ud803\udc8f":"\ud803\udccf","\ud803\udc90":"\ud803\udcd0","\ud803\udc91":"\ud803\udcd1","\ud803\udc92":"\ud803\udcd2","\ud803\udc93":"\ud803\udcd3","\ud803\udc94":"\ud803\udcd4","\ud803\udc95":"\ud803\udcd5","\ud803\udc96":"\ud803\udcd6","\ud803\udc97":"\ud803\udcd7","\ud803\udc98":"\ud803\udcd8","\ud803\udc99":"\ud803\udcd9","\ud803\udc9a":"\ud803\udcda","\ud803\udc9b":"\ud803\udcdb","\ud803\udc9c":"\ud803\udcdc","\ud803\udc9d":"\ud803\udcdd","\ud803\udc9e":"\ud803\udcde","\ud803\udc9f":"\ud803\udcdf","\ud803\udca0":"\ud803\udce0","\ud803\udca1":"\ud803\udce1","\ud803\udca2":"\ud803\udce2","\ud803\udca3":"\ud803\udce3","\ud803\udca4":"\ud803\udce4","\ud803\udca5":"\ud803\udce5","\ud803\udca6":"\ud803\udce6","\ud803\udca7":"\ud803\udce7","\ud803\udca8":"\ud803\udce8","\ud803\udca9":"\ud803\udce9","\ud803\udcaa":"\ud803\udcea","\ud803\udcab":"\ud803\udceb","\ud803\udcac":"\ud803\udcec","\ud803\udcad":"\ud803\udced","\ud803\udcae":"\ud803\udcee","\ud803\udcaf":"\ud803\udcef","\ud803\udcb0":"\ud803\udcf0","\ud803\udcb1":"\ud803\udcf1","\ud803\udcb2":"\ud803\udcf2","\ud803\udd50":"\ud803\udd70","\ud803\udd51":"\ud803\udd71","\ud803\udd52":"\ud803\udd72","\ud803\udd53":"\ud803\udd73","\ud803\udd54":"\ud803\udd74","\ud803\udd55":"\ud803\udd75","\ud803\udd56":"\ud803\udd76","\ud803\udd57":"\ud803\udd77","\ud803\udd58":"\ud803\udd78","\ud803\udd59":"\ud803\udd79","\ud803\udd5a":"\ud803\udd7a","\ud803\udd5b":"\ud803\udd7b","\ud803\udd5c":"\ud803\udd7c","\ud803\udd5d":"\ud803\udd7d","\ud803\udd5e":"\ud803\udd7e","\ud803\udd5f":"\ud803\udd7f","\ud803\udd60":"\ud803\udd80","\ud803\udd61":"\ud803\udd81","\ud803\udd62":"\ud803\udd82","\ud803\udd63":"\ud803\udd83","\ud803\udd64":"\ud803\udd84","\ud803\udd65":"\ud803\udd85","\ud806\udca0":"\ud806\udcc0","\ud806\udca1":"\ud806\udcc1","\ud806\udca2":"\ud806\udcc2","\ud806\udca3":"\ud806\udcc3","\ud806\udca4":"\ud806\udcc4","\ud806\udca5":"\ud806\udcc5","\ud806\udca6":"\ud806\udcc6","\ud806\udca7":"\ud806\udcc7","\ud806\udca8":"\ud806\udcc8","\ud806\udca9":"\ud806\udcc9","\ud806\udcaa":"\ud806\udcca","\ud806\udcab":"\ud806\udccb","\ud806\udcac":"\ud806\udccc","\ud806\udcad":"\ud806\udccd","\ud806\udcae":"\ud806\udcce","\ud806\udcaf":"\ud806\udccf","\ud806\udcb0":"\ud806\udcd0","\ud806\udcb1":"\ud806\udcd1","\ud806\udcb2":"\ud806\udcd2","\ud806\udcb3":"\ud806\udcd3","\ud806\udcb4":"\ud806\udcd4","\ud806\udcb5":"\ud806\udcd5","\ud806\udcb6":"\ud806\udcd6","\ud806\udcb7":"\ud806\udcd7","\ud806\udcb8":"\ud806\udcd8","\ud806\udcb9":"\ud806\udcd9","\ud806\udcba":"\ud806\udcda","\ud806\udcbb":"\ud806\udcdb","\ud806\udcbc":"\ud806\udcdc","\ud806\udcbd":"\ud806\udcdd","\ud806\udcbe":"\ud806\udcde","\ud806\udcbf":"\ud806\udcdf","\ud81b\ude40":"\ud81b\ude60","\ud81b\ude41":"\ud81b\ude61","\ud81b\ude42":"\ud81b\ude62","\ud81b\ude43":"\ud81b\ude63","\ud81b\ude44":"\ud81b\ude64","\ud81b\ude45":"\ud81b\ude65","\ud81b\ude46":"\ud81b\ude66","\ud81b\ude47":"\ud81b\ude67","\ud81b\ude48":"\ud81b\ude68","\ud81b\ude49":"\ud81b\ude69","\ud81b\ude4a":"\ud81b\ude6a","\ud81b\ude4b":"\ud81b\ude6b","\ud81b\ude4c":"\ud81b\ude6c","\ud81b\ude4d":"\ud81b\ude6d","\ud81b\ude4e":"\ud81b\ude6e","\ud81b\ude4f":"\ud81b\ude6f","\ud81b\ude50":"\ud81b\ude70","\ud81b\ude51":"\ud81b\ude71","\ud81b\ude52":"\ud81b\ude72","\ud81b\ude53":"\ud81b\ude73","\ud81b\ude54":"\ud81b\ude74","\ud81b\ude55":"\ud81b\ude75","\ud81b\ude56":"\ud81b\ude76","\ud81b\ude57":"\ud81b\ude77","\ud81b\ude58":"\ud81b\ude78","\ud81b\ude59":"\ud81b\ude79","\ud81b\ude5a":"\ud81b\ude7a","\ud81b\ude5b":"\ud81b\ude7b","\ud81b\ude5c":"\ud81b\ude7c","\ud81b\ude5d":"\ud81b\ude7d","\ud81b\ude5e":"\ud81b\ude7e","\ud81b\ude5f":"\ud81b\ude7f","\ud83a\udd00":"\ud83a\udd22","\ud83a\udd01":"\ud83a\udd23","\ud83a\udd02":"\ud83a\udd24","\ud83a\udd03":"\ud83a\udd25","\ud83a\udd04":"\ud83a\udd26","\ud83a\udd05":"\ud83a\udd27","\ud83a\udd06":"\ud83a\udd28","\ud83a\udd07":"\ud83a\udd29","\ud83a\udd08":"\ud83a\udd2a","\ud83a\udd09":"\ud83a\udd2b","\ud83a\udd0a":"\ud83a\udd2c","\ud83a\udd0b":"\ud83a\udd2d","\ud83a\udd0c":"\ud83a\udd2e","\ud83a\udd0d":"\ud83a\udd2f","\ud83a\udd0e":"\ud83a\udd30","\ud83a\udd0f":"\ud83a\udd31","\ud83a\udd10":"\ud83a\udd32","\ud83a\udd11":"\ud83a\udd33","\ud83a\udd12":"\ud83a\udd34","\ud83a\udd13":"\ud83a\udd35","\ud83a\udd14":"\ud83a\udd36","\ud83a\udd15":"\ud83a\udd37","\ud83a\udd16":"\ud83a\udd38","\ud83a\udd17":"\ud83a\udd39","\ud83a\udd18":"\ud83a\udd3a","\ud83a\udd19":"\ud83a\udd3b","\ud83a\udd1a":"\ud83a\udd3c","\ud83a\udd1b":"\ud83a\udd3d","\ud83a\udd1c":"\ud83a\udd3e","\ud83a\udd1d":"\ud83a\udd3f","\ud83a\udd1e":"\ud83a\udd40","\ud83a\udd1f":"\ud83a\udd41","\ud83a\udd20":"\ud83a\udd42","\ud83a\udd21":"\ud83a\udd43"};

  function referenceKey(label) {
    if ([...label].length > 999 || !label.trim()) return null;
    let escaped = false;
    for (const char of label) {
      if (!escaped && (char === "[" || char === "]")) return null;
      if (!escaped && char === "\\") escaped = true;
      else escaped = false;
    }
    return [...label.replace(/[\p{Zs}\t\r\n\f]+/gu, " ").replace(/^ +| +$/g, "")]
      .map(char => REFERENCE_CASE_FOLD[char] || char).join("");
  }

  function referenceLabelAt(source, opening, end = source.length) {
    if (source[opening] !== "[") return null;
    for (let cursor = opening + 1; cursor < end; cursor++) {
      if (source[cursor] === "\\" && ESCAPABLE.test(source[cursor + 1] || "")) { cursor++; continue; }
      if (source[cursor] === "[") return null;
      if (source[cursor] === "]") {
        const label = source.slice(opening + 1, cursor);
        const key = referenceKey(label);
        return key || label === "" ? {key, empty: label === "", end: cursor + 1} : null;
      }
    }
    return null;
  }

  // Returns an exclusive source endpoint, leaving all source bytes untouched.
  // A malformed next-line title leaves the valid destination-only definition.
  function referenceDefinitionAt(source, start = 0) {
    let cursor = start;
    while (source[cursor] === " " && cursor - start < 4) cursor++;
    if (cursor - start > 3) return null;
    const label = referenceLabelAt(source, cursor);
    if (!label || !label.key || source[label.end] !== ":") return null;
    cursor = label.end + 1;
    const horizontal = () => { while (/[ \t]/.test(source[cursor] || "")) cursor++; };
    const newline = () => {
      if (source[cursor] === "\r") { cursor++; if (source[cursor] === "\n") cursor++; return true; }
      if (source[cursor] === "\n") { cursor++; return true; }
      return false;
    };
    horizontal();
    if (newline()) horizontal();
    let from = cursor, to;
    if (source[cursor] === "<") {
      from = ++cursor;
      while (cursor < source.length && source[cursor] !== ">") {
        if (source[cursor] === "\\" && ESCAPABLE.test(source[cursor + 1] || "")) { cursor += 2; continue; }
        if (/[<\r\n]/.test(source[cursor])) return null;
        cursor++;
      }
      if (source[cursor] !== ">") return null;
      to = cursor++;
    } else {
      let parentheses = 0;
      while (cursor < source.length && !/[\u0000-\u0020\u007f<>]/.test(source[cursor])) {
        if (source[cursor] === "\\" && ESCAPABLE.test(source[cursor + 1] || "")) { cursor += 2; continue; }
        if (source[cursor] === "(") parentheses++;
        if (source[cursor] === ")" && --parentheses < 0) return null;
        cursor++;
      }
      if (parentheses || cursor === from) return null;
      to = cursor;
    }
    const destinationEnd = cursor;
    horizontal();
    const lineEnd = cursor;
    const nextLine = newline();
    if (nextLine) horizontal();
    const delimiter = source[cursor];
    let title = null;
    if ((cursor > destinationEnd) && delimiter && /["'(]/.test(delimiter)) {
      const closing = delimiter === "(" ? ")" : delimiter;
      const titleStart = ++cursor;
      let valid = true;
      while (cursor < source.length && source[cursor] !== closing) {
        if (source[cursor] === "\\" && ESCAPABLE.test(source[cursor + 1] || "")) { cursor += 2; continue; }
        if (delimiter === "(" && source[cursor] === "(") { valid = false; break; }
        cursor++;
      }
      const rawTitle = source.slice(titleStart, cursor);
      valid = valid && source[cursor] === closing && !/\n[ \t]*\n/.test(rawTitle.replace(/\r\n|\r/g, "\n"));
      if (valid) {
        cursor++; horizontal();
        valid = cursor === source.length || /[\r\n]/.test(source[cursor]);
      }
      if (!valid) return nextLine ? {key: label.key, href: linkValue(source.slice(from, to)), title: null, end: lineEnd} : null;
      title = linkValue(rawTitle);
    } else if (nextLine) cursor = lineEnd;
    else if (cursor !== source.length && !/[\r\n]/.test(source[cursor])) return null;
    return {key: label.key, href: linkValue(source.slice(from, to)), title, end: cursor};
  }

  function containsLink(tokens) {
    return tokens.some(token => token.type === "link" || token.children && containsLink(token.children));
  }

  function tokenizeInline(value, start = 0, end = String(value).length, depth = 0, inLink = false, labelProbe = false, references = null) {
    const source = String(value);
    const tokens = [];
    const plain = (from, to, text = source.slice(from, to)) => {
      const previous = tokens[tokens.length - 1];
      if (previous && previous.type === "text" && !previous.escaped && from === previous.end && text === source.slice(from, to)) {
        previous.end = to; previous.text += text;
      } else tokens.push({ type: "text", start: from, end: to, text, escaped: text !== source.slice(from, to) });
    };
    if (depth > 64) return [{ type: "text", start, end, text: source.slice(start, end) }];
    for (let cursor = start; cursor < end;) {
      const char = source[cursor];
      if (char === "\\" && cursor + 1 < end && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(source[cursor + 1])) {
        plain(cursor, cursor + 2, source[cursor + 1]); cursor += 2; continue;
      }
      if (char === "`") {
        const code = TextUtils.codeSpanAt(source, cursor);
        if (code && code.end <= end) {
          let text = source.slice(code.contentStart, code.contentEnd).replace(/\r\n|\r|\n/g, " ");
          let contentStart = code.contentStart, contentEnd = code.contentEnd;
          if (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text)) {
            text = text.slice(1, -1); contentStart += 1; contentEnd -= 1;
          }
          tokens.push({ type: "code", ...code, contentStart, contentEnd, text }); cursor = code.end; continue;
        }
        let runEnd = cursor + 1;
        while (runEnd < end && source[runEnd] === "`") runEnd += 1;
        plain(cursor, runEnd); cursor = runEnd; continue;
      }
      if (char === "\n") { tokens.push({ type: "break", start: cursor, end: cursor + 1 }); cursor += 1; continue; }
      if (!inLink && char === "<") {
        const closing = source.indexOf(">", cursor + 1);
        if (closing >= 0 && closing < end) {
          const label = source.slice(cursor + 1, closing);
          const uri = /^[a-z][a-z0-9+.-]{1,31}:[^\u0000-\u0020<>]*$/i.test(label);
          const email = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(label);
          if (uri || email) {
            tokens.push({ type: "link", start: cursor, end: closing + 1,
              contentStart: cursor + 1, contentEnd: closing, href: email ? "mailto:" + label : label,
              autolink: true, children: [{type: "text", start: cursor + 1, end: closing, text: label}] });
            cursor = closing + 1; continue;
          }
        }
      }
      if (!inLink && !labelProbe && (cursor === start || /[\s([{>]/.test(source[cursor - 1]))) {
        const rest = source.slice(cursor, end);
        const url = rest.match(/^(?:https?:\/\/|www\.)[^\s<>\u0000-\u001f]+/i);
        const email = !url && rest.match(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/i);
        if (url || email) {
          let label = (url || email)[0];
          if (url) {
            let previous;
            do {
              previous = label; label = label.replace(/[.,!?;:]+$/, "");
              for (const [left, right] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
                while (label.endsWith(right) && label.split(right).length > label.split(left).length) label = label.slice(0, -1);
              }
            } while (label !== previous);
          } else label = label.replace(/[.,!?;:]+$/, "");
          if (email || /^(?:https?:\/\/|www\.)[^/?#]+/i.test(label)) {
            const finish = cursor + label.length;
            tokens.push({type: "link", start: cursor, end: finish, contentStart: cursor, contentEnd: finish,
              href: email ? "mailto:" + label : /^www\./i.test(label) ? "https://" + label : label,
              autolink: true, children: [{type: "text", start: cursor, end: finish, text: label}]});
            cursor = finish; continue;
          }
        }
      }
      if (!inLink && char === "[") {
        let closing = cursor + 1, level = 1;
        for (; closing < end; closing += 1) {
          if (source[closing] === "\\") { closing += 1; continue; }
          const code = TextUtils.codeSpanAt(source, closing);
          if (code && code.end <= end) { closing = code.end - 1; continue; }
          if (source[closing] === "[") level += 1;
          if (source[closing] === "]" && --level === 0) break;
        }
        if (closing < end && source[closing + 1] === "(") {
          const destination = linkDestinationAt(source, closing + 1, end);
          if (destination) {
            const children = tokenizeInline(source, cursor + 1, closing, depth + 1, false, true, references);
            if (!containsLink(children)) {
              tokens.push({ type: "link", start: cursor, ...destination,
                contentStart: cursor + 1, contentEnd: closing, children });
              cursor = destination.end; continue;
            }
          }
        }
        if (closing < end && references) {
          const following = referenceLabelAt(source, closing + 1, end);
          const key = following && !following.empty ? following.key : referenceKey(source.slice(cursor + 1, closing));
          const definition = key && references.get(key);
          if (definition) {
            const children = tokenizeInline(source, cursor + 1, closing, depth + 1, false, true, references);
            if (!containsLink(children)) {
              const finish = following ? following.end : closing + 1;
              tokens.push({type: "link", start: cursor, end: finish, contentStart: cursor + 1,
                contentEnd: closing, href: definition.href, title: definition.title, referenceKey: key, children});
              cursor = finish; continue;
            }
          }
        }
      }
      if (char === "*" || char === "_" || char === "~") {
        let runEnd = cursor + 1;
        while (runEnd < end && source[runEnd] === char) runEnd += 1;
        const width = runEnd - cursor;
        const word = /[\p{L}\p{N}]/u;
        const allowed = (char !== "~" || width === 2) && width <= 3
          && runEnd < end && !/\s/.test(source[runEnd])
          && !(char === "_" && word.test(source[cursor - 1] || "") && word.test(source[runEnd]));
        if (allowed) {
          let closing = runEnd;
          while (closing < end) {
            if (source[closing] === "\\") { closing += 2; continue; }
            const code = TextUtils.codeSpanAt(source, closing);
            if (code && code.end <= end) { closing = code.end; continue; }
            if (source[closing] === char) {
              let after = closing + 1;
              while (after < end && source[after] === char) after += 1;
              if (after - closing === width && !/\s/.test(source[closing - 1])
                  && !(char === "_" && word.test(source[closing - 1]) && word.test(source[after] || ""))) {
                tokens.push({ type: char === "~" ? "delete" : width === 1 ? "em" : width === 2 ? "strong" : "strong-em",
                  start: cursor, end: after, contentStart: runEnd, contentEnd: closing,
                  children: tokenizeInline(source, runEnd, closing, depth + 1, inLink, labelProbe, references) });
                cursor = after; break;
              }
              closing = after;
            } else closing += 1;
          }
          if (cursor >= runEnd) continue;
        }
        plain(cursor, runEnd); cursor = runEnd; continue;
      }
      plain(cursor, cursor + 1); cursor += 1;
    }
    return tokens;
  }

  function renderInlineTokens(tokens) {
    return tokens.map(token => {
      if (token.type === "text") return TextUtils.escapeHtml(token.text);
      if (token.type === "break") return "<br>";
      if (token.type === "code") return `<code>${TextUtils.escapeHtml(token.text)}</code>`;
      const content = renderInlineTokens(token.children);
      if (token.type === "link") {
        const href = safeLinkHref(token.href);
        return `<a${href == null ? "" : ` href="${TextUtils.escapeAttr(href)}"`}${token.title == null ? "" : ` title="${TextUtils.escapeAttr(token.title)}"`} target="_blank" rel="noopener noreferrer">${content}</a>`;
      }
      if (token.type === "strong-em") return `<em><strong>${content}</strong></em>`;
      const tag = { em: "em", strong: "strong", delete: "del" }[token.type];
      return `<${tag}>${content}</${tag}>`;
    }).join("");
  }

  function renderInline(text, references = null) {
    return renderInlineTokens(tokenizeInline(text,0,String(text).length,0,false,false,references)) || "<br>";
  }

  function serializeBlocks(surface) {
    const lines = [];
    Array.from(surface.children).forEach((child) => {
      serializeBlock(child, lines);
    });
    return lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  }

  function serializeBlock(element, lines) {
    const tag = element.tagName;
    if (/^H[1-6]$/.test(tag)) {
      lines.push(`${"#".repeat(Number(tag.slice(1)))} ${withoutHardBreaks(inlineMarkdown(element))}`);
      return;
    }
    if (tag === "HR") {
      lines.push("---");
      return;
    }
    if (tag === "BLOCKQUOTE") {
      lines.push(withHardBreaks(inlineMarkdown(element), "> "));
      return;
    }
    if (tag === "PRE") {
      if (element.dataset.blockType === "table" || element.classList.contains("amorist-markdown-table")) {
        lines.push(TableCodec.formatMarkdownTable(element.textContent));
        return;
      }
      lines.push(`\`\`\`\n${element.textContent.replace(/\n$/, "")}\n\`\`\``);
      return;
    }
    if (tag === "UL" || tag === "OL") {
      lines.push(serializeList(element, "").join("\n"));
      return;
    }
    if (tag === "DIV" && BLOCK_TAGS.has(element.firstElementChild?.tagName || "")) {
      Array.from(element.children).forEach((child) => serializeBlock(child, lines));
      return;
    }
    lines.push(withHardBreaks(inlineMarkdown(element), ""));
  }

  // Markdown writes a hard break as two trailing spaces. Block text carries breaks
  // as "\n", and each block re-applies its own prefix to the continuation: a bare
  // newline would drop the continuation out of the block — an unquoted second line
  // stops being part of the quote — instead of breaking the line inside it.
  function withHardBreaks(text, prefix, continuation = prefix) {
    return text
      .split("\n")
      .map((line, index) => (index === 0 ? prefix : continuation) + line)
      .join("  \n");
  }

  // Blocks that are a single line by construction. A heading has no second line,
  // and a list item's continuation would need lazy-continuation parsing that this
  // codec does not have — writing one would come back as a separate paragraph and
  // tear the item apart, so the break degrades to a space instead.
  function withoutHardBreaks(text) {
    return text.replace(/\n/g, " ");
  }

  // Returns the list's lines rather than pushing them as a block, so a sublist
  // stays glued to its parent item instead of being separated by a blank line.
  // Children indent to the parent marker's content column, which is what keeps
  // them nested (and not siblings) when the Markdown is parsed back.
  function serializeList(element, indent) {
    const ordered = element.tagName === "OL";
    const lines = [];
    let number = 0;
    Array.from(element.children).forEach((item) => {
      if (item.tagName !== "LI") return;
      number += 1;
      const marker = ordered ? `${number}. ` : "- ";
      lines.push(`${indent}${marker}${withoutHardBreaks(listItemMarkdown(item))}`);
      Array.from(item.children).forEach((child) => {
        if (child.tagName === "UL" || child.tagName === "OL") {
          lines.push(...serializeList(child, indent + " ".repeat(marker.length)));
        }
      });
    });
    return lines;
  }

  function listItemMarkdown(item) {
    if (!item.classList.contains("amorist-task-item")) return inlineMarkdown(item);
    const checked = item.dataset.checked === "true" ? "x" : " ";
    return `[${checked}] ${inlineMarkdown(item.querySelector(".amorist-task-content") || item)}`;
  }

  function inlineMarkdown(node) {
    let output = "";
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        output += child.textContent;
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child;
      if (element.classList.contains("amorist-task-checkbox")) return;
      switch (element.tagName) {
        case "STRONG":
        case "B":
          output += `**${inlineMarkdown(element)}**`;
          break;
        case "EM":
        case "I":
          output += `*${inlineMarkdown(element)}*`;
          break;
        case "CODE":
          output += `\`${element.textContent}\``;
          break;
        case "A":
          output += `[${inlineMarkdown(element)}](${element.getAttribute("href") || ""})`;
          break;
        case "BR":
          output += "\n";
          break;
        case "UL":
        case "OL":
          // A sublist inside a list item is a block, not inline content:
          // serializeList emits it with its own indent. Falling through to the
          // default here would splice its text into the parent item's line.
          break;
        default:
          output += inlineMarkdown(element);
      }
    });
    return output.replace(/\u00a0/g, " ").replace(/\u200b/g, "").trim();
  }

  Internals.MarkdownCodec = {
    parseBlocks,
    renderMarkdown,
    serializeBlocks,
    renderInline,
    tokenizeInline,
    safeLinkHref,
    linkDestinationAt,
    referenceKey,
    referenceLabelAt,
    referenceDefinitionAt,
    inlineMarkdown,
  };
})();
