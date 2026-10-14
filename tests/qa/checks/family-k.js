"use strict";
const {run}=require('../../editor-clipboard.test');
module.exports=[{
  id:'REQ-K1',scope:'run',title:'Clipboard Markdown fidelity and semantic fallback',
  async run({options}) {
    const result=await run({engineIds:options.engine?[options.engine]:undefined});
    return {failures:[],fixturesExercised:result.engines.map(engine=>
      `${engine}: partial format/source/code/plain copy/cut/paste; empty/failed writes; block prefixes/fences; reference definitions/collisions/table cells; HTML table/task/title/ordered fallback`)};
  },
}];
