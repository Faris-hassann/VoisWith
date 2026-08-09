import { createServer } from "node:http";

/**
 * The acceptance fixture (DESIGN-DECISIONS.md §11): 6 pages, a login, and 4
 * forms with deliberately seeded defects.
 *
 * Form design is constrained by §4's privileged-form classifier, and the
 * constraints are load-bearing — get them wrong and the form is blocked
 * instead of tested, which looks like a passing run:
 *
 *  - Every seeded form carries **3+ visible fields**. A 1-2 field form with no
 *    validation surface is soft-blocked (filled, never submitted), and three
 *    of the four defects are only observable by submitting.
 *  - No submit label may match §4's verb list (delete/remove/revoke/…/send/pay).
 *    A contact form button reading "Send" would be hard-blocked, so it reads
 *    "Submit enquiry" instead.
 *  - No field name/label may match role|permission|admin|…|secret.
 *  - The only `type=password` lives on /login, which the classifier detects as
 *    a login page; a password box anywhere else is hard-blocked.
 *
 * Seeded defects, one per form:
 *   1. /signup   — email field is type=text with no pattern: invalid email accepted (HIGH)
 *   2. /contact  — submit is type=button and wired to nothing: submit does nothing (HIGH)
 *   3. /feedback — no required/pattern/minlength anywhere: missing validation attributes (MEDIUM)
 *   4. /login    — clean control: correct types, required, minlength (passes)
 *
 * The newsletter form in the shared footer is intentionally identical on
 * /about and /pricing so §7 dedup fires and emits form:duplicate_skipped.
 */
const HOST = "127.0.0.1";
const PORT = 43117;

const NAV = `<nav>
  <a href="/">Home</a>
  <a href="/login">Login</a>
  <a href="/signup">Signup</a>
  <a href="/contact">Contact</a>
  <a href="/feedback">Feedback</a>
  <a href="/about">About</a>
  <a href="/pricing">Pricing</a>
</nav>`;

/**
 * Repeated verbatim on /about and /pricing. Same route-family-independent
 * field signature, so §7 collapses it to one tested form.
 */
const FOOTER_FORM = `<footer>
  <form id="newsletter" method="post" action="/subscribe">
    <label for="nl-name">Name</label>
    <input id="nl-name" name="name" type="text" required>
    <label for="nl-email">Email</label>
    <input id="nl-email" name="email" type="email" required>
    <label for="nl-company">Company</label>
    <input id="nl-company" name="company" type="text">
    <button type="submit">Subscribe</button>
  </form>
</footer>`;

const page = (title, body, { footer = false } = {}) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<h1>${title}</h1>
${NAV}
${body}
${footer ? FOOTER_FORM : ""}
</body>
</html>
`;

const PAGES = {
  "/": page("Home", "<p>Acceptance fixture for authorized automated testing.</p>"),

  // Clean control: correct input types, required, and a minlength.
  "/login": page(
    "Login",
    `<form id="login" method="post" action="/session">
  <label for="username">Email</label>
  <input id="username" name="username" type="email" required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" required minlength="8">
  <!-- Deliberately no maxlength: the browser truncates at maxlength, so a
       "reject over-long input" expectation can never be falsified and would
       show up as a phantom finding on the clean control. -->
  <label for="workspace">Workspace</label>
  <input id="workspace" name="workspace" type="text" required>
  <button type="submit">Sign in</button>
</form>`,
  ),

  // Seeded defect 1: email is type=text with no pattern, so the server accepts
  // "not-an-email" and reports success.
  "/signup": page(
    "Create your profile",
    `<form id="signup" method="post" action="/profile">
  <label for="su-name">Full name</label>
  <input id="su-name" name="fullname" type="text" required>
  <label for="su-email">Email</label>
  <input id="su-email" name="email" type="text">
  <label for="su-company">Company</label>
  <input id="su-company" name="company" type="text">
  <button type="submit">Create profile</button>
</form>`,
  ),

  // Seeded defect 2: the control is type=button with no handler, so clicking
  // it does nothing at all — no navigation, no message, no validation.
  "/contact": page(
    "Contact",
    `<form id="contact-form" method="post" action="/enquiry">
  <label for="c-name">Name</label>
  <input id="c-name" name="name" type="text" required>
  <label for="c-email">Email</label>
  <input id="c-email" name="email" type="email" required>
  <label for="c-message">Message</label>
  <textarea id="c-message" name="message" required></textarea>
  <!-- type="button" with no handler: the control the user would click does nothing. -->
  <button type="button" id="contact-submit">Submit enquiry</button>
</form>`,
  ),

  // Seeded defect 3: three fields, not one attribute of validation between
  // them — no required, no pattern, no minlength, no typed inputs.
  "/feedback": page(
    "Feedback",
    `<form id="feedback-form" method="post" action="/feedback">
  <label for="f-subject">Subject</label>
  <input id="f-subject" name="subject" type="text">
  <label for="f-detail">Detail</label>
  <input id="f-detail" name="detail" type="text">
  <label for="f-contact">Contact</label>
  <input id="f-contact" name="contact" type="text">
  <button type="submit">Submit feedback</button>
</form>`,
  ),

  "/about": page("About", "<p>Who we are.</p>", { footer: true }),
  "/pricing": page("Pricing", "<p>What it costs.</p>", { footer: true }),
};

const ACCEPT_POST = new Set(["/subscribe", "/session", "/profile", "/enquiry", "/feedback"]);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const body = PAGES[url.pathname];

  // Served so the browser's automatic request does not 404 on every page and
  // register as a console error — the acceptance finding set must contain the
  // seeded defects and nothing else.
  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && body) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
    return;
  }

  if (req.method === "POST" && ACCEPT_POST.has(url.pathname)) {
    // Every accepted POST reports success — including /profile with a garbage
    // email, which is precisely seeded defect 1.
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page("Thanks", '<p role="status" class="success">Received. Thank you.</p>'));
    });
    return;
  }

  res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  res.end(page("Not found", "<p>No such page.</p>"));
});

server.listen(PORT, HOST, () => {
  console.log(`Fixture test site listening at http://${HOST}:${PORT} (${Object.keys(PAGES).length} pages)`);
});
