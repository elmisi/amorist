(function () {
  "use strict";
  async function install(options) {
    var ready = false, running = false, requested = false, initial = true;
    async function pump() {
      requested = true;
      if (!ready || running) return;
      running = true;
      try {
        while (requested) {
          requested = false;
          var requests = await options.take();
          for (var request of requests) {
            if (request.error) { options.error(request.error); continue; }
            while (options.isBusy()) await new Promise(function (resolve) { setTimeout(resolve, 50); });
            try {
              var useInitial = initial && options.canUseInitial();
              initial = false;
              if (useInitial) await options.openInitial(request.path);
              else await options.spawn(request.path);
            } catch (error) { options.error(error); }
          }
        }
      } catch (error) { options.error(error); }
      finally { running = false; }
    }
    await options.listen(function () { pump(); });
    return {
      ready: function () { ready = true; return pump(); },
      claim: function () { initial = false; },
    };
  }
  var api = { install: install };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.AmoristNativeOpen = api;
})();
