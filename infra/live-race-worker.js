// Cloudflare Worker — JSON relay for Pilots Future titles.
// Deploy at Cloudflare Dashboard -> Workers & Pages -> Create Worker -> Edit code.
// Copy the deployed https://...workers.dev URL to the CG panel proxy field.
// No API keys or user credentials are required.
const UPSTREAM = 'https://sf.fgdrrace.ru/api';
const ALLOWED_ORIGIN = 'https://kds1988.github.io';

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    };
    if (request.method === 'OPTIONS') return new Response(null, {status:204,headers});
    if (request.method !== 'GET') return new Response(JSON.stringify({error:'GET only'}),{status:405,headers});
    try {
      const response = await fetch(UPSTREAM, {
        headers:{Accept:'application/json'},
        cf:{cacheTtl:0,cacheEverything:false}
      });
      if(!response.ok) return new Response(JSON.stringify({error:'upstream HTTP '+response.status}),{status:502,headers});
      const data = await response.json();
      if(!data || !Array.isArray(data.players)) throw Error('Missing players array');
      return new Response(JSON.stringify(data),{status:200,headers});
    } catch(err) {
      return new Response(JSON.stringify({error:'relay unavailable',detail:String(err.message||err)}),{status:502,headers});
    }
  }
};
