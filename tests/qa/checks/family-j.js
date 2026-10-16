"use strict";
const {run} = require('../../editor-settings.test');
module.exports = [{
  id: 'REQ-J1', scope: 'run', title: 'Settings preview, transactional application and active-line geometry',
  async run({options}) {
    const result = await run({engineIds: options.engine ? [options.engine] : undefined});
    return {failures: [], fixturesExercised: result.engines.map(engine =>
      `${engine}: preview/cancel/failed-save/retry/focus; typography/source preservation; active soft-wrap/source/backward/Select-All line; clipped code; destroyed-preview viewport`)};
  },
}];
