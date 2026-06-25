# Getting Selectors

Small Node.js tool for extracting web selectors with Playwright and visible Chromium.

## How it works

1. Edit `input.json`
2. Run `npm install`
3. Run `npm start`
4. Watch Chromium open and follow the console logs
5. Read the extracted selectors in `output.json`

## Input

```json
{
  "target": "https://example.com/login",
  "isWeb": true,
  "elements": ["Username", "Password", "Submit"]
}
```

## Output

```json
{
  "mode": "web",
  "target": "https://example.com/login",
  "matches": {
    "Username": "[name='username']",
    "Password": "#password",
    "Submit": "#submit-btn"
  },
  "unmatched": []
}
```

## Notes

- This version is web-only.
- `isWeb` must be `true`.
- Chromium opens in headed mode so you can track what happens during the run.
