# Getting UiPath Selectors

Small Node.js tool for extracting UiPath-ready selectors from both web pages and Windows desktop applications, with SAP GUI for Windows handled as a first-class desktop target.

## What it does

- Uses Playwright to inspect web pages and collect stable DOM attributes.
- Uses Windows UI Automation through PowerShell for generic desktop applications.
- Uses SAP GUI Scripting first for SAP desktop applications.
- Normalizes all supported sources into one shared output contract.
- Emits UiPath-oriented selectors as the primary output.
- Keeps CSS selectors only for web debugging and browser-side discovery.

## Folder structure

The selector tool is now split so shared concerns can live in focused components:

```text
index.js                         CLI entrypoint and orchestration
src/config/paths.js              Runtime paths and defaults
src/shared/logger.js             Consistent console logging
src/services/manualCheckpointService.js
                                 Pause the run and wait for user confirmation
capture-desktop.ps1              Desktop capture integration
input.json                       Default runtime input
output.json                      Generated selector output
```

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
Web targets can now execute a small interaction flow before selector extraction. This lets you open a page, click links or buttons, optionally pass through Microsoft sign-in, and then extract the selector from the final page state.

```json
{
  "mode": "web",
  "target": "https://portal.azure.com/",
  "flow": [
    {
      "action": "manual",
      "message": "Sign in to Azure Portal and wait on the home page.",
      "resumeOnNotUrlIncludes": ["login.microsoftonline.com"],
      "resumeOnElement": {
        "label": "Kubernetes center",
        "type": "link",
        "possibleNames": ["Kubernetes center", "Kubernetes Center"]
      },
      "requireEnter": false,
      "timeoutMs": 900000,
      "pollIntervalMs": 2000
    },
    {
      "action": "click",
      "target": "Kubernetes center",
      "elementType": "link",
      "possibleNames": ["Kubernetes center", "Kubernetes Center"],
      "postWaitMs": 3000
    },
    {
      "action": "manual",
      "message": "Wait while Kubernetes Center finishes loading.",
      "resumeOnElement": {
        "label": "Search",
        "type": "input",
        "possibleNames": ["Search", "Search resources", "Search by keyword", "Search..."]
      },
      "requireEnter": false,
      "postWaitMs": 1500
    }
  ],
  "microsoftLogin": {
    "username": "",
    "password": "",
    "staySignedIn": false
  },
  "elements": [
    {
      "label": "Search",
      "type": "input",
      "possibleNames": ["Search", "Search resources", "Search by keyword", "Search..."]
    }
  ]
}
```

### Supported `flow` actions

- `click`: find an element on the current page using the same fuzzy matching logic as selector extraction, then click it.
- `type`: find an input-like element, then fill it with `value` or `credentialField`.
- `goto`: navigate to a specific `url`.
- `wait`: pause for `ms`.
- `manual`: keep the browser open while you do a manual step, then continue after you press Enter in the terminal.
- `waitForNavigation`: wait for the current page to finish loading.

`manual` also supports automatic resume conditions:

```json
{
  "action": "manual",
  "message": "Sign in and open the target page.",
  "resumeOnNotUrlIncludes": ["login.microsoftonline.com"],
  "resumeOnElement": {
    "label": "Search",
    "type": "input",
    "possibleNames": ["Search", "Search..."]
  },
  "requireEnter": false,
  "timeoutMs": 900000,
  "pollIntervalMs": 2000
}
```

Useful `manual` fields:

- `resumeOnUrlIncludes`: continue when the current URL contains one of these values.
- `resumeOnNotUrlIncludes`: continue when the current URL no longer contains these values.
- `resumeOnElement`: continue when a target element becomes detectable on the page.
- `requireEnter`: if `true`, still wait for Enter; if `false`, auto-resume is enough.
- `timeoutMs`: maximum wait time for the manual step.
- `pollIntervalMs`: how often to re-check the page state.

`click` and `type` accept either:

```json
{
  "action": "click",
  "target": "Manual",
  "elementType": "link",
  "possibleNames": ["Manual"]
}
```

or:

```json
{
  "action": "type",
  "element": {
    "label": "User Name",
    "type": "input",
    "possibleNames": ["Username", "Login"]
  },
  "value": "someone@example.com"
}
```

### Microsoft sign-in

If the page redirects to a Microsoft sign-in screen, you can provide credentials in `microsoftLogin`:

```json
{
  "microsoftLogin": {
    "username": "someone@example.com",
    "password": "secret",
    "staySignedIn": false
  }
}
```

The tool will try to fill the Microsoft username page, continue, fill the password page, and optionally click `No` on the "Stay signed in?" prompt when `staySignedIn` is `false`.

### Azure Portal workflow

For Azure Portal, the safest flow is usually a manual checkpoint because tenants can add MFA, conditional access, and extra prompts. The default `input.json` now opens `https://portal.azure.com/`, waits for you to sign in, clicks `Kubernetes center`, and then auto-resumes once the page search input is detectable.

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
