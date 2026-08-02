import type {
  Credentials,
  LocaleMatrixEntry,
  RoleCredentials,
  RoleName,
  TestingRunRequest,
  ViewportMatrixEntry,
} from "../types/testing.js";

export interface RoleExecutionTarget {
  name: RoleName;
  credentials?: Credentials;
}

export interface MatrixExecutionTarget {
  role: RoleExecutionTarget;
  viewport: ViewportMatrixEntry;
  locale: LocaleMatrixEntry;
}

const DEFAULT_VIEWPORTS: ViewportMatrixEntry[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

const DEFAULT_LOCALES: LocaleMatrixEntry[] = [
  { name: "english-ltr", locale: "en-US", direction: "ltr" },
  { name: "arabic-rtl", locale: "ar", direction: "rtl" },
];

export function buildRoleTargets(request: TestingRunRequest): RoleExecutionTarget[] {
  if (request.roles?.length) {
    return request.roles.map((role) => ({
      name: role.name,
      credentials: mergeRoleCredentials(role),
    }));
  }
  return [{ name: "Default", credentials: request.credentials }];
}

export function buildMatrixTargets(request: TestingRunRequest): MatrixExecutionTarget[] {
  const roles = buildRoleTargets(request);
  const viewports = request.testMatrix?.enabled
    ? request.testMatrix.viewports.length > 0
      ? request.testMatrix.viewports
      : DEFAULT_VIEWPORTS
    : [{ name: "default", ...request.browser.viewport }];
  const locales = request.testMatrix?.enabled
    ? request.testMatrix.locales.length > 0
      ? request.testMatrix.locales
      : DEFAULT_LOCALES
    : [{ name: "default", locale: "en-US", direction: "ltr" as const }];

  return roles.flatMap((role) =>
    viewports.flatMap((viewport) =>
      locales.map((locale) => ({
        role,
        viewport,
        locale,
      })),
    ),
  );
}

function mergeRoleCredentials(role: RoleCredentials): Credentials {
  return {
    ...role.credentials,
    loginUrl: role.loginUrl ?? role.credentials.loginUrl,
    fieldHints: role.fieldHints ?? role.credentials.fieldHints,
  };
}
