import * as models from '../models';
import {getRenderedRequest} from  '../common/render';
import {jarFromCookies} from '../common/cookies';
import * as util from '../common/misc';

export function exportHarWithRequest (renderedRequest, addContentLength = false) {
  if (addContentLength) {
    const hasContentLengthHeader = !!renderedRequest.headers.find(
      h => h.name.toLowerCase() === 'content-length'
    );

    if (!hasContentLengthHeader) {
      const name = 'content-length';
      const value = Buffer.byteLength(renderedRequest.body).toString();
      renderedRequest.headers.push({name, value})
    }
  }

  return {
    method: renderedRequest.method,
    url: util.prepareUrlForSending(renderedRequest.url),
    httpVersion: 'HTTP/1.1',
    cookies: getCookies(renderedRequest),
    headers: renderedRequest.headers,
    queryString: renderedRequest.parameters,
    postData: {text: renderedRequest.body},
    headersSize: -1,
    bodySize: -1
  };
}

export async function exportHar (requestId, environmentId, addContentLength = false) {
  const request = await models.request.getById(requestId);
  const renderedRequest = await getRenderedRequest(request, environmentId);
  return exportHarWithRequest(renderedRequest, addContentLength);
}

function getCookies (renderedRequest) {
  const jar = jarFromCookies(renderedRequest.cookieJar.cookies);
  const domainCookies = jar.getCookiesSync(renderedRequest.url);
  return domainCookies.map(c => Object.assign(c.toJSON(), {
    name: c.key
  }));
}
