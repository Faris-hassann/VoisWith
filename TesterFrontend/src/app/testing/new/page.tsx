import { TestConfigurationForm } from "@/components/testing/TestConfigurationForm";

export default function NewTestPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure an authorized functional test run using the backend contract from Swagger.
        </p>
      </div>
      <TestConfigurationForm />
    </div>
  );
}
