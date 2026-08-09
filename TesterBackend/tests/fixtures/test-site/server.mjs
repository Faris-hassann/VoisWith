import { createServer } from "node:http";

/**
 * Minimal acceptance fixture (DESIGN-DECISIONS.md §11, scoped down for Phase
 * 3's plan-only verification): 3 pages, 4 forms, 4 deliberately seeded
 * defects — one accepting an invalid email, one with a dead submit, one with
 * no validation attributes, one clean control.
 */
const HOST = "127.0.0.1";
const PORT = 43117;

const PAGE = (title, body) => `<!doctype html>
<html>
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
<nav><a href="/">Home</a> <a href="/login">Login</a> <a href="/contact">Contact</a></nav>
${body}
</body>
</html>
`;

const PAGES = {
  "/": PAGE(
    "Home",
    `
<!-- Seeded defect: no type="email"/required, so an invalid address is accepted without complaint. -->
<form id="newsletter" method="post" action="/subscribe">
  <label for="email">Email</label>
  <input id="email" name="email" type="text" placeholder="you@example.com">
  <button type="submit">Subscribe</button>
</form>
`,
  ),
  "/login": PAGE(
    "Login",
    `
<!-- Clean control: real validation attributes, nothing seeded here. -->
<form id="login" method="post" action="/session">
  <label for="username">Email</label>
  <input id="username" name="username" type="email" required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" required minlength="8">
  <button type="submit">Sign in</button>
</form>
`,
  ),
  "/contact": PAGE(
    "Contact",
    `
<!-- Seeded defect: submit control is type="button", so clicking it does nothing. -->
<form id="contact-form">
  <label for="message">Message</label>
  <textarea id="message" name="message"></textarea>
  <button type="button" id="contact-submit">Send</button>
</form>
<!-- Seeded defect: no required/maxlength/pattern on a free-text field. -->
<form id="feedback-form" method="post" action="/feedback">
  <label for="feedback">Feedback</label>
  <input id="feedback" name="feedback" type="text">
  <button type="submit">Submit Feedback</button>
</form>
`,
  ),
};

const THANKS = PAGE("Thanks", "<p>Received.</p>");

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const page = PAGES[url.pathname];
  if (req.method === "GET" && page) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
    return;
  }
  if (req.method === "POST" && ["/subscribe", "/session", "/feedback"].includes(url.pathname)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(THANKS);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Fixture test site listening at http://${HOST}:${PORT}`);
});
