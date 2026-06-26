param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Normalize-Value {
  param([object]$Value)

  if ($null -eq $Value) {
    return $null
  }

  $text = [string]$Value
  $text = $text -replace "\s+", " "
  $text = $text.Trim()

  if ([string]::IsNullOrWhiteSpace($text)) {
    return $null
  }

  return $text
}

function Get-ProcessNameSafe {
  param([int]$ProcessId)

  try {
    return (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName
  } catch {
    return $null
  }
}

function Get-ControlTypeName {
  param([System.Windows.Automation.AutomationElement]$Element)

  $programmaticName = $Element.Current.ControlType.ProgrammaticName
  if ([string]::IsNullOrWhiteSpace($programmaticName)) {
    return $null
  }

  if ($programmaticName -match "\.(?<name>[^.]+)$") {
    return $matches["name"]
  }

  return $programmaticName
}

function Matches-Target {
  param(
    [string]$Candidate,
    [string]$Desired
  )

  if ([string]::IsNullOrWhiteSpace($Desired)) {
    return $true
  }

  if ([string]::IsNullOrWhiteSpace($Candidate)) {
    return $false
  }

  return $Candidate.ToLowerInvariant().Contains($Desired.ToLowerInvariant())
}

function Build-Candidate {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationElement]$WindowElement
  )

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $parent = $walker.GetParent($Element)
  $processName = Get-ProcessNameSafe -ProcessId $Element.Current.ProcessId

  $candidate = [ordered]@{
    processId    = $Element.Current.ProcessId
    processName  = Normalize-Value $processName
    automationId = Normalize-Value $Element.Current.AutomationId
    name         = Normalize-Value $Element.Current.Name
    className    = Normalize-Value $Element.Current.ClassName
    controlType  = Normalize-Value (Get-ControlTypeName -Element $Element)
    frameworkId  = Normalize-Value $Element.Current.FrameworkId
    helpText     = Normalize-Value $Element.Current.HelpText
    accessKey    = Normalize-Value $Element.Current.AccessKey
    isEnabled    = [bool]$Element.Current.IsEnabled
    isOffscreen  = [bool]$Element.Current.IsOffscreen
    parent       = if ($null -ne $parent) {
      [ordered]@{
        name         = Normalize-Value $parent.Current.Name
        automationId = Normalize-Value $parent.Current.AutomationId
        className    = Normalize-Value $parent.Current.ClassName
        controlType  = Normalize-Value (Get-ControlTypeName -Element $parent)
      }
    } else {
      $null
    }
    window       = [ordered]@{
      title       = Normalize-Value $WindowElement.Current.Name
      className   = Normalize-Value $WindowElement.Current.ClassName
      processId   = $WindowElement.Current.ProcessId
      processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $WindowElement.Current.ProcessId)
    }
  }

  return [pscustomobject]$candidate
}

$input = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
$target = $input.target

if ($target -is [string]) {
  $targetDescriptor = [pscustomobject]@{
    windowTitle = $target
    processName = $null
  }
} else {
  $targetDescriptor = $target
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$matchedWindows = @()

for ($index = 0; $index -lt $windows.Count; $index++) {
  $window = $windows.Item($index)
  $processName = Get-ProcessNameSafe -ProcessId $window.Current.ProcessId
  $title = Normalize-Value $window.Current.Name

  if (-not (Matches-Target -Candidate $processName -Desired $targetDescriptor.processName)) {
    continue
  }

  if (-not (Matches-Target -Candidate $title -Desired $targetDescriptor.windowTitle)) {
    continue
  }

  $score = 0
  if (-not [string]::IsNullOrWhiteSpace($targetDescriptor.processName) -and $processName -eq $targetDescriptor.processName) {
    $score += 50
  } elseif (-not [string]::IsNullOrWhiteSpace($targetDescriptor.processName) -and $processName) {
    $score += 20
  }

  if (-not [string]::IsNullOrWhiteSpace($targetDescriptor.windowTitle) -and $title -eq $targetDescriptor.windowTitle) {
    $score += 50
  } elseif (-not [string]::IsNullOrWhiteSpace($targetDescriptor.windowTitle) -and $title) {
    $score += 20
  }

  $matchedWindows += [pscustomobject]@{
    Score       = $score
    Window      = $window
    ProcessName = Normalize-Value $processName
    Title       = $title
  }
}

if ($matchedWindows.Count -eq 0) {
  throw "No desktop application window matched the requested target."
}

$selectedWindow = $matchedWindows | Sort-Object Score -Descending | Select-Object -First 1
$windowElement = $selectedWindow.Window
$allDescendants = $windowElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$supportedTypes = @(
  "Edit",
  "Button",
  "ComboBox",
  "Hyperlink",
  "Document",
  "CheckBox",
  "RadioButton",
  "ListItem",
  "MenuItem",
  "TabItem",
  "Text"
)

$candidates = @()

for ($index = 0; $index -lt $allDescendants.Count; $index++) {
  $element = $allDescendants.Item($index)
  $controlType = Get-ControlTypeName -Element $element

  if ($supportedTypes -notcontains $controlType) {
    continue
  }

  $candidate = Build-Candidate -Element $element -WindowElement $windowElement

  if ($candidate.isOffscreen) {
    continue
  }

  if ([string]::IsNullOrWhiteSpace($candidate.name) -and [string]::IsNullOrWhiteSpace($candidate.automationId)) {
    continue
  }

  $candidates += $candidate
}

$warnings = @()
if ($candidates.Count -eq 0) {
  $warnings += "Desktop capture found the window but no visible actionable controls with stable metadata."
}

$output = [ordered]@{
  targetWindow = [ordered]@{
    title       = Normalize-Value $windowElement.Current.Name
    className   = Normalize-Value $windowElement.Current.ClassName
    processId   = $windowElement.Current.ProcessId
    processName = Normalize-Value (Get-ProcessNameSafe -ProcessId $windowElement.Current.ProcessId)
  }
  warnings     = $warnings
  candidates   = $candidates
}

$output | ConvertTo-Json -Depth 8
