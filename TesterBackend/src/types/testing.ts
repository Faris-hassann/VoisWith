import type { Locator } from "playwright";
import type { TestingType } from "../testing/test-types.js";
import type {
  ConsoleObservation,
  NetworkObservation,
  PerformanceObservation,
} from "./report.js";

export interface Credentials {
  enabled?: boolean;
  loginUrl?: string;
  username: string;
  password: string;
  fieldHints?: {
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
  };
}

export type TestEnvironment = "production" | "staging";
export type RoleName = "Admin" | "Agent" | "Client" | "Default";
export type LocaleDirection = "ltr" | "rtl";

export interface RoleCredentials {
  name: RoleName;
  credentials: Credentials;
  loginUrl?: string;
  fieldHints?: Credentials["fieldHints"];
}

export interface ViewportMatrixEntry {
  name: string;
  width: number;
  height: number;
}

export interface LocaleMatrixEntry {
  name: string;
  locale: string;
  direction: LocaleDirection;
}

export interface TestMatrixSettings {
  enabled: boolean;
  viewports: ViewportMatrixEntry[];
  locales: LocaleMatrixEntry[];
}

export interface TestingRunRequest {
  targetUrl: string;
  authorizationConfirmed: boolean;
  environment?: TestEnvironment;
  credentials?: Credentials;
  roles?: RoleCredentials[];
  allowedOrigins?: string[];
  includeSubdomains?: boolean;
  browserMode?: "headed" | "headless";
  visualizationMode?: "local" | "live" | "off";
  testData?: Record<string, unknown>;
  testTypes: TestingType[];
  crawl: {
    strategy: "DFS";
    maxDepth?: number;
    maxPages?: number;
    sameOriginOnly: boolean;
    includePatterns: string[];
    excludePatterns: string[];
    ignoredQueryParameters?: string[];
  };
  browser: {
    channel: "chrome";
    headless: boolean;
    viewport: {
      width: number;
      height: number;
    };
  };
  execution: {
    safeMode: boolean;
    allowFormSubmission: boolean;
    allowFileUploads: boolean;
    allowDestructiveActions: boolean;
    allowPayments: boolean;
    maximumActionsPerPage: number;
    maximumRunDurationSeconds: number;
  };
  testMatrix?: TestMatrixSettings;
}

export interface PageSnapshot {
  url: string;
  canonicalUrl: string;
  stateFingerprint?: string;
  title: string;
  headings: string[];
  landmarks?: string[];
  visibleText: string;
  links: LinkSnapshot[];
  images: AssetSnapshot[];
  scripts: AssetSnapshot[];
  elements: ElementInventoryItem[];
  forms: FormSnapshot[];
  tables: string[];
  dialogs: ElementInventoryItem[];
  currentQueryParameters: Record<string, string>;
  consoleErrors: ConsoleObservation[];
  failedRequests: NetworkObservation[];
  observedApiCalls: NetworkObservation[];
  performance: PerformanceObservation[];
  visibleValidationErrors: string[];
  uiObservations: UiObservation[];
}

export interface UiObservation {
  name: string;
  status: "PASSED" | "FAILED" | "INCONCLUSIVE";
  description: string;
  count?: number;
}

export interface AssetSnapshot {
  src: string;
  canonicalSrc?: string;
  alt?: string;
  type?: string;
  internal: boolean;
}

export interface LinkSnapshot {
  text: string;
  href: string;
  canonicalHref?: string;
  internal: boolean;
  sourceElementId?: string;
}

export interface FormSnapshot {
  elementId: string;
  implicit?: boolean;
  method?: string;
  action?: string;
  fields: ElementInventoryItem[];
  submitControls: ElementInventoryItem[];
  apparentPurpose?: string;
}

export interface ElementInventoryItem {
  id: string;
  kind:
    | "link"
    | "button"
    | "input"
    | "textarea"
    | "select"
    | "checkbox"
    | "radio"
    | "file"
    | "form"
    | "dialog"
    | "tab"
    | "menu"
    | "pagination"
    | "search"
    | "submit"
    | "other";
  tagName: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  type?: string;
  value?: string;
  disabled: boolean;
  hidden: boolean;
  required?: boolean;
  validation?: Record<string, string | number | boolean>;
  formAction?: string;
  formMethod?: string;
  formOwnerElementId?: string;
  locator: LocatorDescriptor;
}

export interface LocatorDescriptor {
  strategy: "role" | "label" | "placeholder" | "testId" | "name" | "css";
  value: string;
  role?: string;
  exact?: boolean;
}

export interface ResolvedElement {
  item: ElementInventoryItem;
  locator: Locator;
}
