# Getting UiPath Selectors

Small Node.js tool for extracting UiPath-ready selectors from both web pages and Windows desktop applications.

## What it does

- Uses Playwright to inspect web pages and collect stable DOM attributes.
- Uses Windows UI Automation through PowerShell to inspect desktop application controls.
- Normalizes both sources into one shared output contract.
- Emits UiPath-oriented XML selectors as the primary output.
- Keeps CSS selectors only for web debugging and browser-side discovery.

## How it works

1. Edit `input.json` or pass a different input file path to `node index.js`.
2. Run `npm install`
3. Run `npm start`
4. For web targets, watch Chromium open and follow the console logs.
5. Read the extracted UiPath selector payload in `output.json`.

You can also run:

```bash
node index.js path/to/input.json path/to/output.json
```

## Web input

Backward compatibility is kept for `isWeb: true`, but `mode` is the preferred field.

```json
{
  "mode": "web",
  "target": "https://www.facebook.com/",
  "elements": ["Email address", "Password", "Login"]
}
```

## Desktop input

Desktop targets accept a descriptor object. At least one of `windowTitle`, `processName`, or `executablePath` must be present.

```json
{
  "mode": "desktop",
  "target": {
    "processName": "explorer",
    "windowTitle": "File Explorer"
  },
  "elements": ["Share", "Details"]
}
```

## Output contract

Web output:

```json
{
  "mode": "uipath_web",
  "target": "https://www.facebook.com/",
  "elements": [
    {
      "label": "Email address",
      "intent": "username_or_email",
      "controlType": "input",
      "sourceAttributes": {
        "tag": "INPUT",
        "name": "email",
        "placeholder": "Email address or mobile number"
      },
      "selectors": {
        "css": "[name='email']",
        "uipath_strict": "<webctrl tag='INPUT' name='email' />",
        "uipath_fallback": "<webctrl tag='INPUT' placeholder='Email address or mobile number' />"
      },
      "recommendedAction": "Type Into",
      "valueVariable": "in_EmailAddress",
      "confidence": "high",
      "warnings": []
    }
  ],
  "unmatched": [],
  "warnings": []
}
```

Desktop output:

```json
{
  "mode": "uipath_desktop",
  "target": {
    "title": "about - File Explorer",
    "className": "CabinetWClass",
    "processName": "explorer"
  },
  "elements": [
    {
      "label": "Share",
      "intent": "generic",
      "controlType": "button",
      "sourceAttributes": {
        "automationId": "shareButton",
        "name": "Share",
        "controlType": "button"
      },
      "selectors": {
        "uipath_strict": "<wnd app='explorer.exe' cls='CabinetWClass' title='about - File Explorer' /><ctrl automationid='shareButton' role='button' />",
        "uipath_fallback": "<wnd app='explorer.exe' cls='CabinetWClass' title='about - File Explorer' /><ctrl role='button' name='Share' />",
        "anchorStrategy": null
      },
      "recommendedAction": "Click",
      "valueVariable": null,
      "confidence": "high",
      "warnings": []
    }
  ],
  "unmatched": [],
  "warnings": []
}
```

## Notes

- UiPath XML selectors are the primary automation output.
- CSS selectors are included only for web debugging and discovery.
- Web element matching tries exact and fuzzy attribute/text matching, so requests like `"Email address"` can match placeholders such as `"Email address or mobile number"`.
- Desktop matching prioritizes stable UI Automation attributes such as `AutomationId`, `Name`, control type, and window context.
- Low-confidence or weak matches are flagged in warnings instead of silently emitting unsafe selectors.
