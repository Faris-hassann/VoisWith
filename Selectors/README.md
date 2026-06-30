# Getting UiPath Selectors

Small Node.js tool for extracting UiPath-ready selectors from both web pages and Windows desktop applications, with SAP GUI for Windows handled as a first-class desktop target.

## What it does

- Uses Playwright to inspect web pages and collect stable DOM attributes.
- Uses Windows UI Automation through PowerShell for generic desktop applications.
- Uses SAP GUI Scripting first for SAP desktop applications.
- Normalizes all supported sources into one shared output contract.
- Emits UiPath-oriented selectors as the primary output.
- Keeps CSS selectors only for web debugging and browser-side discovery.

## How it works

1. Edit `input.json` or pass a different input file path to `node index.js`.
2. Run `npm install`
3. Run `npm start`
4. For web targets, watch Chromium open and follow the console logs.
5. Read the extracted selector payload in `output.json`.

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

Generic desktop example:

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

SAP desktop example:

```json
{
  "mode": "desktop",
  "target": {
    "processName": "saplogon",
    "windowTitle": "SAP Easy Access",
    "sap": {
      "systemName": "PRD",
      "connectionName": "ECC Production",
      "sessionIndex": 0,
      "windowTitle": "SAP Easy Access"
    }
  },
  "elements": [
    {
      "label": "Command field",
      "type": "input",
      "possibleNames": ["/n", "ok code", "command"]
    },
    {
      "label": "Enter button",
      "type": "button",
      "possibleNames": ["Enter", "Execute"]
    }
  ]
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

Generic desktop output:

```json
{
  "mode": "uipath_desktop",
  "target": {
    "title": "about - File Explorer",
    "className": "CabinetWClass",
    "processName": "explorer",
    "kind": "desktop_generic"
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
        "anchorStrategy": null,
        "nativeText": null,
        "screenRegion": null,
        "sap": null
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

SAP desktop output:

```json
{
  "mode": "uipath_desktop",
  "target": {
    "title": "SAP Easy Access",
    "className": "SAP_FRONTEND_SESSION",
    "processName": "saplogon",
    "kind": "desktop_sap"
  },
  "elements": [
    {
      "label": "Command field",
      "intent": "generic",
      "controlType": "input",
      "sourceAttributes": {
        "processName": "saplogon",
        "frameworkId": "SAP",
        "captureKind": "sap",
        "sessionId": "/app/con[0]/ses[0]",
        "windowId": "wnd[0]",
        "systemName": "PRD",
        "connectionName": "ECC Production",
        "transactionCode": "SESSION_MANAGER",
        "componentId": "ctxtRSYST-BCODE",
        "componentPath": "wnd[0]/tbar[0]/okcd",
        "componentType": "GuiOkCodeField",
        "technicalName": "okcd",
        "tooltip": "Command field"
      },
      "selectors": {
        "uipath_strict": "<wnd app='saplogon.exe' cls='SAP_FRONTEND_SESSION' title='SAP Easy Access' />",
        "uipath_fallback": null,
        "anchorStrategy": null,
        "nativeText": null,
        "screenRegion": null,
        "sap": {
          "source": "sap_scripting",
          "sessionId": "/app/con[0]/ses[0]",
          "windowId": "wnd[0]",
          "componentId": "ctxtRSYST-BCODE",
          "path": "wnd[0]/tbar[0]/okcd",
          "componentType": "GuiOkCodeField",
          "technicalName": "okcd",
          "parentPath": "wnd[0]/tbar[0]",
          "transactionCode": "SESSION_MANAGER",
          "systemName": "PRD",
          "connectionName": "ECC Production"
        }
      },
      "recommendedAction": "Type Into",
      "valueVariable": "in_CommandField",
      "confidence": "high",
      "warnings": ["SAP native selector emitted"]
    }
  ],
  "unmatched": [],
  "warnings": []
}
```

## Notes

- UiPath XML selectors remain the primary automation output.
- CSS selectors are included only for web debugging and discovery.
- Web element matching tries exact and fuzzy attribute/text matching, so requests like `"Email address"` can match placeholders such as `"Email address or mobile number"`.
- Generic desktop matching prioritizes stable UI Automation attributes such as `AutomationId`, `Name`, control type, and window context.
- Generic desktop apps can still fall back to OCR when UI Automation metadata is too weak.
- SAP desktop requests never fall back to OCR. If SAP GUI Scripting cannot provide a stable native selector, the element is returned as unmatched.
- SAP-native selector payloads are emitted under `selectors.sap` so downstream UiPath mapping can use session, window, and component IDs directly.
