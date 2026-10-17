/* NoNotes – WebMCP: der Werkzeugkatalog für den Agenten des Browsers (docs/AGENTS.md). i18n-ignore-file

   WebMCP (Entwurf der W3C-Gemeinschaft Web Machine Learning, Google und Microsoft) lässt eine Seite ihre Werkzeuge dem Agenten
   des Browsers melden: document.modelContext.registerTool({ name, description, inputSchema, annotations, execute }). Der Agent
   (Copilot in Edge, Gemini in Chrome) sieht die Werkzeuge des offenen Tabs, zeigt Aufrufe an und fragt vor Änderungen. Netz
   und Dateien sind nicht beteiligt: execute() ruft den Katalog, der Katalog das Backend der Seite, gespeichert wird wie sonst.

   Die Namen der Schnittstelle sind noch nicht endgültig (ältere Fassungen hiessen navigator.modelContext, manche kennen nur
   provideContext({ tools })); diese Datei kapselt sie an einer Stelle. Ohne Schnittstelle im Browser passiert nichts.

   Aufruf:  const r = await NoNotesWebMcp.attach({ catalog, onChange, log })
            r.attached (true, wenn Werkzeuge gemeldet sind), r.tools (Namen), await r.detach() */
(function (global) {
  'use strict';

  function context() {
    const d = global.document;
    if (d && d.modelContext) return d.modelContext;
    if (global.navigator && global.navigator.modelContext) return global.navigator.modelContext;
    return null;
  }

  function available() {
    const mc = context();
    return !!(mc && (typeof mc.registerTool === 'function' || typeof mc.provideContext === 'function'));
  }

  function definition(catalog, tool, onChange, log) {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      async execute(input) {
        const r = await catalog.call(tool.name, input == null ? {} : input);
        if (!r.isError && !tool.annotations.readOnlyHint && onChange) {
          try { await onChange(tool.name); } catch (e) { log('WebMCP: refresh after tool call failed', tool.name, e); }
        }
        return r;
      },
    };
  }

  async function attach(o) {
    const log = o.log || (() => {});
    const mc = context();
    const none = { attached: false, tools: [], detach: async () => {} };
    if (!mc) return none;
    const defs = o.catalog.list().map(t => definition(o.catalog, t, o.onChange, log));
    const names = [];
    if (typeof mc.registerTool === 'function') {
      for (const def of defs) {
        try { await mc.registerTool(def); names.push(def.name); }
        catch (e) { log('WebMCP: tool not registered', def.name, e); }
      }
    } else if (typeof mc.provideContext === 'function') {
      try { await mc.provideContext({ tools: defs }); names.push(...defs.map(d => d.name)); }
      catch (e) { log('WebMCP: provideContext failed', e); }
    } else {
      return none;
    }
    return {
      attached: names.length > 0,
      tools: names,
      async detach() {
        if (typeof mc.unregisterTool === 'function') for (const n of names) { try { await mc.unregisterTool(n); } catch (e) { /* egal */ } }
        else if (typeof mc.clearContext === 'function') { try { await mc.clearContext(); } catch (e) { /* egal */ } }
        names.length = 0;
      },
    };
  }

  global.NoNotesWebMcp = { attach, available };
})(window);
