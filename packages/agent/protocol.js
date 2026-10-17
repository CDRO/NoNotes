/* NoNotes – MCP (Model Context Protocol) ohne Transport (docs/AGENTS.md). i18n-ignore-file

   Macht aus dem Werkzeugkatalog (packages/agent/catalog.js) einen MCP-Server, der JSON-RPC-Nachrichten entgegennimmt und
   Antworten liefert. Woher die Nachrichten kommen (Standardeingabe eines Prozesses, HTTP im Dienst), entscheidet der Aufrufer.
   Verstanden werden die Protokollfassungen 2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25 und der zustandslose Entwurf
   2026-07-28: Der Server führt keine Sitzungen, braucht keine Begrüssung (initialize), verträgt sie aber, und beantwortet
   jede Anfrage für sich.

   Aufruf:  const server = NoNotesMcp.createServer({ catalog, name, version, instructions, log })
            await server.handle(message)   → Antwort (Objekt), Liste von Antworten (bei einer Liste) oder null (Benachrichtigung)
            await server.handleText(text)  → dasselbe aus rohem JSON; kaputtes JSON gibt einen Parse-Fehler zurück */
(function (global) {
  'use strict';

  const VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
  const DEFAULT_VERSION = '2025-06-18';
  const CODES = { PARSE: -32700, INVALID: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603, RESOURCE: -32002 };

  function rpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id: id === undefined ? null : id, error };
  }

  function rpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  function createServer(o) {
    const catalog = o.catalog;
    const info = { name: o.name || 'nonotes', title: o.title || 'NoNotes', version: o.version || 'dev' };
    const log = o.log || (() => {});

    const methods = {
      initialize(params) {
        const wanted = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : null;
        return {
          protocolVersion: wanted && VERSIONS.includes(wanted) ? wanted : DEFAULT_VERSION,
          capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
          serverInfo: info,
          instructions: o.instructions || catalog.instructions || undefined,
        };
      },
      ping() { return {}; },
      'tools/list'() { return { tools: catalog.list() }; },
      async 'tools/call'(params) {
        const name = params && typeof params.name === 'string' ? params.name : '';
        if (!catalog.has(name)) throw Object.assign(new Error(`Unknown tool: ${name || '(none)'}`), { rpc: CODES.PARAMS });
        const args = params && params.arguments != null ? params.arguments : {};
        if (typeof args !== 'object' || Array.isArray(args)) throw Object.assign(new Error('arguments must be an object'), { rpc: CODES.PARAMS });
        const r = await catalog.call(name, args);
        const out = { content: r.content };
        if (r.structuredContent !== undefined) out.structuredContent = r.structuredContent;
        if (r.isError) out.isError = true;
        return out;
      },
      'resources/list'() { return { resources: catalog.resources() }; },
      'resources/templates/list'() { return { resourceTemplates: catalog.resourceTemplates() }; },
      async 'resources/read'(params) {
        const uri = params && typeof params.uri === 'string' ? params.uri : '';
        try {
          const c = await catalog.readResource(uri);
          return { contents: [{ uri: c.uri, mimeType: c.mimeType, text: c.text }] };
        } catch (e) {
          if (e && typeof e.code === 'string') throw Object.assign(new Error(e.code === 'RESOURCE_NOT_FOUND' ? 'Resource not found' : e.message), { rpc: CODES.RESOURCE, data: { uri } });
          throw e;
        }
      },
      'prompts/list'() { return { prompts: [] }; },
      'logging/setLevel'() { return {}; },
    };

    const NOTIFICATIONS = new Set(['notifications/initialized', 'notifications/cancelled', 'notifications/roots/list_changed', 'notifications/progress']);

    async function one(msg) {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, CODES.INVALID, 'Invalid request');
      const id = msg.id;
      const isRequest = id !== undefined && id !== null && (typeof id === 'string' || typeof id === 'number');
      if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isRequest ? rpcError(id, CODES.INVALID, 'Invalid request') : (msg.id === null ? rpcError(null, CODES.INVALID, 'Invalid request') : null);
      if (!isRequest) {
        if (!NOTIFICATIONS.has(msg.method) && !msg.method.startsWith('notifications/')) log('MCP: unknown notification', msg.method);
        return null; // Benachrichtigungen werden nie beantwortet
      }
      const fn = methods[msg.method];
      if (!fn) return rpcError(id, CODES.METHOD, `Method not found: ${msg.method}`);
      try {
        return rpcResult(id, await fn(msg.params, msg));
      } catch (e) {
        if (e && typeof e.rpc === 'number') return rpcError(id, e.rpc, e.message, e.data);
        log('MCP: request failed', msg.method, e);
        return rpcError(id, CODES.INTERNAL, 'Internal error');
      }
    }

    async function handle(message) {
      if (Array.isArray(message)) {
        if (!message.length) return rpcError(null, CODES.INVALID, 'Invalid request');
        const out = (await Promise.all(message.map(one))).filter(Boolean);
        return out.length ? out : null;
      }
      return one(message);
    }

    async function handleText(text) {
      let msg;
      try { msg = JSON.parse(String(text)); }
      catch (e) { return rpcError(null, CODES.PARSE, 'Parse error'); }
      return handle(msg);
    }

    return { handle, handleText, methods: Object.keys(methods), info, VERSIONS };
  }

  global.NoNotesMcp = { createServer, VERSIONS, DEFAULT_VERSION, CODES };
})(window);
