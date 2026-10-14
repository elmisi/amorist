(function () {
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});

  // Elements removed entirely (content discarded).
  const STRIPPED = new Set(["SCRIPT", "STYLE", "HEAD", "META", "LINK", "TITLE", "NOSCRIPT"]);
  // Inline wrappers with no Markdown meaning: replace with their children.
  const UNWRAPPED = new Set(["SPAN", "FONT", "U", "S", "SMALL", "ABBR", "TIME", "MARK"]);

  function isStripped(tag) {
    return STRIPPED.has(tag);
  }
  function isUnwrapped(tag) {
    return UNWRAPPED.has(tag);
  }

  function cleanupMarkdown(md) {
    // Trailing whitespace is noise except in one case: two spaces after text are
    // a hard line break. Stripping indiscriminately would erase every <br> that
    // serializeBlocks just wrote, which is the whole point of the paste path.
    const output = [];
    let closing = null;
    let blanks = 0;
    for (const line of md.split("\n")) {
      if (closing) {
        output.push(line);
        if (closing.test(line)) closing = null;
        continue;
      }
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`);
        output.push(line);
        blanks = 0;
        continue;
      }
      const cleaned = /\S {2,}$/.test(line)
        ? line.replace(/[ \t]*$/, "  ") : line.replace(/[ \t]+$/, "");
      blanks = cleaned ? 0 : blanks + 1;
      if (blanks <= 1) output.push(cleaned);
    }
    return output.join("\n").trim();
  }

  const INLINE_TAGS = new Set(["A", "B", "STRONG", "I", "EM", "CODE", "BR", "SUB", "SUP"]);

  function sanitize(root) {
    // Depth-first; mutate as we go. Work on a static list to avoid live-collection surprises.
    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === 8 /* comment */) {
        node.remove();
        return;
      }
      if (node.nodeType !== 1 /* element */) return; // keep text nodes

      const tag = node.tagName;
      if (isStripped(tag)) {
        node.remove();
        return;
      }
      sanitize(node); // recurse first so children are clean before we unwrap

      if (isUnwrapped(tag)) {
        node.replaceWith(...node.childNodes);
        return;
      }

      // Keep the only Markdown-representable attributes.  In particular an
      // image without alt/src is a silent paste loss.
      Array.from(node.attributes || []).forEach((attr) => {
        const allowed = (tag === "A" && attr.name === "href")
          || (tag === "IMG" && (attr.name === "src" || attr.name === "alt"));
        if (!allowed) {
          node.removeAttribute(attr.name);
        }
      });
    });
  }

  // This converter owns its source output.  It must not route through the
  // editor renderer/serializer: a paste is a local replacement transaction,
  // not a temporary DOM document that can reformat the open file.
  function nodeToSource(node) {
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType !== 1) return "";
    const tag = node.tagName;
    if (tag === "PRE") {
      const text = Internals.TextUtils.normalize(node.textContent || "");
      const fence = Internals.TextUtils.codeFenceFor(text);
      return `${fence}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}\n\n`;
    }
    const children = () => Array.from(node.childNodes).map(nodeToSource).join("");
    if (/^H[1-6]$/.test(tag)) return "#".repeat(Number(tag.slice(1)))+" "+children().trim().replace(/\n/g," ")+"\n\n";
    if (tag === "BLOCKQUOTE") return children().trim().split("\n").map(line=>">"+(line?" "+line:"")).join("\n")+"\n\n";
    if (tag === "BR") return "\n";
    if (tag === "STRONG" || tag === "B") return `**${children()}**`;
    if (tag === "EM" || tag === "I") return `*${children()}*`;
    if (tag === "CODE") {
      const text=(node.textContent || "").replace(/\r\n|\r|\n/g," ");
      if(!text) return "";
      const width=Math.max(0,...Array.from(text.matchAll(/`+/g),match=>match[0].length))+1;
      const fence="`".repeat(width);
      const padded=text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text));
      return fence+(padded?" ":"")+text+(padded?" ":"")+fence;
    }
    const destination=value=>"<"+String(value).replace(/&/g,"&amp;").replace(/\\/g,"\\\\").replace(/[<>]/g,char=>"\\"+char).replace(/\r\n|\r|\n/g,"%0A")+">";
    if (tag === "A") return `[${children()}](${destination(node.getAttribute("href") || "")})`;
    if (tag === "IMG") return `![${String(node.getAttribute("alt") || "").replace(/[\\[\]]/g,char=>"\\"+char)}](${destination(node.getAttribute("src") || "")})`;
    if (tag === "UL" || tag === "OL") {
      let number=Number.parseInt(node.getAttribute("start") || "1",10);
      if(!Number.isFinite(number)) number=1;
      const items=Array.from(node.children).filter(child=>child.tagName==="LI");
      const lines=items.map(item=> {
        const explicit=Number.parseInt(item.getAttribute("value") || "",10);
        if(Number.isFinite(explicit)) number=explicit;
        const marker=tag==="OL" ? `${number++}. ` : "- ";
        const content=Array.from(item.childNodes).map(nodeToSource).join("").trim();
        return content.split("\n").map((line,index)=>index===0 ? marker+line : line ? " ".repeat(marker.length)+line : "").join("\n");
      });
      return "\n"+lines.join("\n")+"\n\n";
    }
    if (tag === "LI") return `- ${children().trim()}\n`;
    if (tag === "TD" || tag === "TH") return children().trim();
    if (tag === "TR") return Array.from(node.children).map(nodeToSource).join(" | ") + "\n";
    if (tag === "TABLE") {
      const rows=Array.from(node.querySelectorAll("tr")).filter(row=>row.closest("table")===node);
      const cells=rows.map(row=>Array.from(row.children).filter(cell=>cell.tagName==="TD" || cell.tagName==="TH")
        .map(cell=>nodeToSource(cell).replace(/\n/g,"<br>").replace(/\|/g,"\\|")));
      const width=Math.max(0,...cells.map(row=>row.length));
      if(!width) return "";
      const line=row=>"| "+Array.from({length:width},(_,index)=>row[index]||"").join(" | ")+" |";
      const header=rows[0] && Array.from(rows[0].children).some(cell=>cell.tagName==="TH");
      const output=header?[line(cells.shift())]:[line(Array(width).fill(""))];
      output.push(line(Array(width).fill("---")),...cells.map(line));
      return output.join("\n")+"\n\n";
    }
    const block = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "PRE"]);
    const text = children();
    return block.has(tag) ? text + "\n\n" : text;
  }

  function convert(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    sanitize(body);
    const md = Array.from(body.childNodes).map(nodeToSource).join("");
    return cleanupMarkdown(md);
  }

  Internals.HtmlToMarkdown = {
    convert,
    _isStripped: isStripped,
    _isUnwrapped: isUnwrapped,
    _cleanupMarkdown: cleanupMarkdown,
    _nodeToSource: nodeToSource,
  };
})();
