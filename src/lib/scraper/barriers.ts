// Detects pages we must not (or cannot) scrape: CAPTCHA / bot challenges and login walls.
// When detected the agent stops for that page - it never tries to bypass them.

const CAPTCHA_MARKERS = [
  /<title>\s*just a moment\.\.\.\s*<\/title>/i,
  /<title>\s*attention required!?\s*\|\s*cloudflare\s*<\/title>/i,
  /cf-browser-verification|cf_chl_opt|challenge-platform\/h\/[bg]\/orchestrate/i,
  /verify (that )?you are (a )?human/i,
  /are you a robot\??/i,
  /please complete the security check/i,
  /px-captcha|perimeterx|datadome|_incapsula_resource|distil_r_captcha/i,
];
const CAPTCHA_WIDGETS = /class=["'][^"']*(g-recaptcha|h-captcha|cf-turnstile)[^"']*["']/i;

export function detectCaptcha(html: string, visibleWordCount: number): boolean {
  if (CAPTCHA_MARKERS.some((re) => re.test(html))) return true;
  // A CAPTCHA widget inside an otherwise-empty page is a challenge; inside a long page it is
  // probably just a contact form, so only treat it as a barrier when the page has little content.
  return CAPTCHA_WIDGETS.test(html) && visibleWordCount < 120;
}

export function detectLoginWall(finalUrl: string, html: string, visibleWordCount: number): boolean {
  const path = (() => {
    try {
      return new URL(finalUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const loginPath = /(^|\/)(login|log-in|signin|sign-in|sso|auth|authenticate|account\/login)(\/|$)/.test(path);
  const hasPassword = /<input[^>]+type=["']?password/i.test(html);
  if (loginPath && (hasPassword || visibleWordCount < 200)) return true;
  return hasPassword && visibleWordCount < 80;
}
