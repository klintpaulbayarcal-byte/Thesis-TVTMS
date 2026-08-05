/* Real-browser contact form acceptance test using Edge's DevTools protocol. */
'use strict';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const debugPort = Number(process.env.EDGE_DEBUG_PORT || 9333);
const landingUrl = 'http://localhost/vehicle-violation-system-EASY-SETUP/frontend/pages/landing.html#contact';

async function retryJson(url, options = {}, attempts = 30) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError;
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  once(method) {
    return new Promise(resolve => {
      const listener = params => {
        const listeners = this.listeners.get(method) || [];
        this.listeners.set(method, listeners.filter(item => item !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  close() {
    this.socket.close();
  }
}

async function main() {
  await retryJson(`http://127.0.0.1:${debugPort}/json/version`);
  const target = await retryJson(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(landingUrl)}`,
    { method: 'PUT' }
  );
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();

  let contactRequests = 0;
  const consoleErrors = [];
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request?.url?.includes('/api/public/contact') && request.method === 'POST') contactRequests += 1;
  });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    consoleErrors.push(exceptionDetails?.text || 'Uncaught browser exception');
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') consoleErrors.push(args.map(arg => arg.value || arg.description || '').join(' '));
  });

  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
    cdp.send('Log.enable'),
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1365, height: 768, deviceScaleFactor: 1, mobile: false
    })
  ]);

  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: landingUrl });
  await loaded;
  await sleep(750);
  consoleErrors.length = 0;

  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  };

  const waitFor = async (expression, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`Browser condition timed out: ${expression}`);
  };

  const fill = values => evaluate(`(() => {
    const values = ${JSON.stringify(values)};
    for (const [id, value] of Object.entries(values)) {
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
  const submit = () => evaluate(`(() => {
    document.getElementById('contactForm').requestSubmit();
    return true;
  })()`);
  const state = () => evaluate(`(() => ({
    note: document.getElementById('cfNote').textContent.trim(),
    success: document.getElementById('cfNote').classList.contains('success'),
    error: document.getElementById('cfNote').classList.contains('error'),
    disabled: document.getElementById('cfSubmit').disabled,
    busy: document.getElementById('cfSubmit').getAttribute('aria-busy')
  }))()`);

  assert(await evaluate(`document.querySelectorAll('#contactForm').length`) === 1, 'Contact form is duplicated.');
  assert(await evaluate(`document.querySelectorAll('#cfSubmit').length`) === 1, 'Submit button is duplicated.');
  assert(await evaluate(`!document.documentElement.innerHTML.toLowerCase().includes('mailto:')`), 'A mailto fallback remains.');

  // Empty form.
  const emptyRequestCount = contactRequests;
  await fill({ cfName: '', cfEmail: '', cfSubject: '', cfMessage: '' });
  await submit();
  await sleep(150);
  let current = await state();
  assert(current.error && /full name/i.test(current.note), 'Empty-form validation message is missing.');
  assert(!current.disabled && contactRequests === emptyRequestCount, 'Empty form sent a request or left the button disabled.');

  // Invalid email.
  const invalidRequestCount = contactRequests;
  await fill({ cfName: 'Browser Test', cfEmail: 'invalid-email', cfSubject: 'Validation', cfMessage: 'Valid message body.' });
  await submit();
  await sleep(150);
  current = await state();
  assert(current.error && /valid email/i.test(current.note), 'Invalid-email validation failed.');
  assert(!current.disabled && contactRequests === invalidRequestCount, 'Invalid email sent a request.');

  // Very long message.
  const longRequestCount = contactRequests;
  await fill({ cfName: 'Browser Test', cfEmail: 'browser-test@example.com', cfSubject: 'Length validation', cfMessage: 'x'.repeat(3001) });
  await submit();
  await sleep(150);
  current = await state();
  assert(current.error && /10.*3000/i.test(current.note), 'Long-message validation failed.');
  assert(!current.disabled && contactRequests === longRequestCount, 'Long message sent a request.');

  // Valid submission plus double-click/single-flight protection.
  const doubleStart = contactRequests;
  await fill({
    cfName: 'Browser Validation',
    cfEmail: 'browser-test@example.com',
    cfSubject: 'BROWSER TEST DOUBLE SUBMISSION',
    cfMessage: 'This validates one-request-only behavior for a rapid double submission.'
  });
  await evaluate(`(() => {
    const form = document.getElementById('contactForm');
    form.requestSubmit();
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(`document.getElementById('cfNote').classList.contains('success')`);
  current = await state();
  assert(contactRequests === doubleStart + 1, 'Double submission sent more than one request.');
  assert(!current.disabled && current.busy === null, 'Button did not recover after valid submission.');

  // Slow backend response: delay real fetch while proving the page remains responsive.
  await evaluate(`(() => {
    window.__contactOriginalFetch = window.fetch;
    window.fetch = (...args) => new Promise((resolve, reject) => {
      setTimeout(() => window.__contactOriginalFetch(...args).then(resolve, reject), 900);
    });
    return true;
  })()`);
  await fill({
    cfName: 'Browser Validation',
    cfEmail: 'browser-test@example.com',
    cfSubject: 'BROWSER TEST SLOW RESPONSE',
    cfMessage: 'This validates that the page stays responsive during a slow response.'
  });
  await submit();
  await sleep(150);
  current = await state();
  assert(current.disabled && current.busy === 'true', 'Slow request did not show the loading state.');
  assert(await evaluate(`(() => { document.body.dataset.contactResponsive = 'yes'; return document.body.dataset.contactResponsive; })()`) === 'yes', 'Page was not responsive during slow request.');
  await waitFor(`document.getElementById('cfNote').classList.contains('success')`);
  await evaluate(`window.fetch = window.__contactOriginalFetch; delete window.__contactOriginalFetch; true`);

  // Backend offline/network error simulation.
  await evaluate(`(() => {
    window.__contactOriginalFetch = window.fetch;
    window.fetch = (...args) => String(args[0]).includes('/api/public/contact')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : window.__contactOriginalFetch(...args);
    return true;
  })()`);
  await fill({
    cfName: 'Browser Validation',
    cfEmail: 'browser-test@example.com',
    cfSubject: 'BROWSER TEST OFFLINE',
    cfMessage: 'This validates recovery when the backend is unavailable.'
  });
  await submit();
  await waitFor(`document.getElementById('cfNote').classList.contains('error')`);
  current = await state();
  assert(/failed to fetch|could not reach/i.test(current.note), 'Offline error message is unclear.');
  assert(!current.disabled, 'Button stayed disabled after offline error.');
  await evaluate(`window.fetch = window.__contactOriginalFetch; delete window.__contactOriginalFetch; true`);

  // Timeout simulation: fetch remains pending until AbortController aborts it.
  await evaluate(`(() => {
    window.__contactOriginalFetch = window.fetch;
    window.fetch = (url, options = {}) => {
      if (!String(url).includes('/api/public/contact')) return window.__contactOriginalFetch(url, options);
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    };
    return true;
  })()`);
  await fill({
    cfName: 'Browser Validation',
    cfEmail: 'browser-test@example.com',
    cfSubject: 'BROWSER TEST TIMEOUT',
    cfMessage: 'This validates timeout recovery without freezing the landing page.'
  });
  await submit();
  await sleep(200);
  assert(await evaluate(`document.getElementById('cfSubmit').disabled`), 'Timeout test did not enter loading state.');
  assert(await evaluate(`(() => { window.__timeoutHeartbeat = 1; return window.__timeoutHeartbeat; })()`) === 1, 'Page froze while request was pending.');
  await waitFor(`document.getElementById('cfNote').textContent.includes('timed out')`, 14000);
  current = await state();
  assert(current.error && !current.disabled, 'Timeout did not restore the form.');
  await evaluate(`window.fetch = window.__contactOriginalFetch; delete window.__contactOriginalFetch; true`);

  // Repeated submission after earlier success/error cycles.
  const repeatStart = contactRequests;
  await fill({
    cfName: 'Browser Validation',
    cfEmail: 'browser-test@example.com',
    cfSubject: 'BROWSER TEST REPEATED SUBMISSION',
    cfMessage: 'This validates a later submission after prior success and error states.'
  });
  await submit();
  await waitFor(`document.getElementById('cfNote').classList.contains('success')`);
  assert(contactRequests === repeatStart + 1, 'Repeated valid submission did not send exactly one request.');
  assert(await evaluate(`['cfName','cfEmail','cfSubject','cfMessage'].every(id => document.getElementById(id).value === '')`), 'Form did not reset after success.');

  // Mobile viewport and unchanged primary navigation.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 812, deviceScaleFactor: 1, mobile: true
  });
  await sleep(300);
  const mobile = await evaluate(`(() => {
    const formRect = document.getElementById('contactForm').getBoundingClientRect();
    const buttonRect = document.getElementById('cfSubmit').getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      formWidth: formRect.width,
      buttonRight: buttonRect.right,
      ticketLookupPresent: Boolean(document.querySelector('a[href="#search-card"]')),
      officerLoginPresent: Boolean(document.querySelector('a[href="login.html"]'))
    };
  })()`);
  assert(mobile.documentWidth <= mobile.viewportWidth + 1, 'Mobile viewport has horizontal overflow.');
  assert(mobile.formWidth <= mobile.viewportWidth && mobile.buttonRight <= mobile.viewportWidth + 1, 'Contact form does not fit mobile viewport.');
  assert(mobile.ticketLookupPresent && mobile.officerLoginPresent, 'Ticket Lookup or Officer Login changed unexpectedly.');

  assert(consoleErrors.length === 0, `Browser console errors remain: ${consoleErrors.join(' | ')}`);

  console.log(JSON.stringify({
    emptyForm: 'PASS',
    invalidEmail: 'PASS',
    validSubmission: 'PASS',
    doubleSubmission: 'PASS',
    slowResponse: 'PASS',
    backendOffline: 'PASS',
    requestTimeout: 'PASS',
    longMessage: 'PASS',
    mobileViewport: 'PASS',
    repeatedSubmission: 'PASS',
    consoleErrors: 0,
    contactRequests
  }, null, 2));
  cdp.close();
}

const keepAlive = setInterval(() => {}, 1000);
main().then(() => {
  clearInterval(keepAlive);
}).catch(error => {
  clearInterval(keepAlive);
  console.error(`CONTACT_BROWSER_TEST_FAILED: ${error.message}`);
  process.exit(1);
});
