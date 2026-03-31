const SUPPORTED_FORMAT = 'pdf';

export async function onRequestPost(context) {
  return proxyRenderRequest(context, SUPPORTED_FORMAT);
}

async function proxyRenderRequest(context, format) {
  const { env, request } = context;
  const baseUrl = env.API_ORIGIN_URL;
  const token = env.API_SHARED_TOKEN;

  if (!baseUrl || !token) {
    return new Response('Server export is not configured.', { status: 500 });
  }

  const upstreamUrl = new URL(`/render/${format}`, baseUrl).toString();
  const body = await request.text();
  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'content-type': request.headers.get('content-type') || 'application/json',
      'x-shared-token': token
    },
    body
  });

  const headers = new Headers();
  const contentType = upstreamResponse.headers.get('content-type');
  const disposition = upstreamResponse.headers.get('content-disposition');

  if (contentType) {
    headers.set('content-type', contentType);
  }

  if (disposition) {
    headers.set('content-disposition', disposition);
  }

  headers.set('cache-control', 'no-store');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers
  });
}
