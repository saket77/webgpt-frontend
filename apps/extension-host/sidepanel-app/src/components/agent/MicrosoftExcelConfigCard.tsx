import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useMicrosoftExcelConfiguration } from "../../hooks/useMicrosoftExcelConfiguration";

function authBadge(authStatus?: string) {
  if (authStatus === "authenticated") {
    return {
      color: "green",
      label: "Connected",
    };
  }

  if (authStatus === "unconfigured") {
    return {
      color: "gray",
      label: "Not configured",
    };
  }

  return {
    color: "yellow",
    label: "Authorization needed",
  };
}

export function MicrosoftExcelConfigCard() {
  const {
    config,
    authStatus,
    draftTenantId,
    setDraftTenantId,
    draftClientId,
    setDraftClientId,
    draftScopes,
    setDraftScopes,
    error,
    loadingAction,
    hasUnsavedChanges,
    refreshConfig,
    saveConfig,
    resetConfig,
    connectMicrosoftExcel,
  } = useMicrosoftExcelConfiguration();

  const badge = authBadge(authStatus?.authStatus);
  const isConfigured = Boolean(config?.configured);

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600} size="sm">
              Microsoft Excel
            </Text>
            <Text size="xs" c="dimmed">
              Connect Excel workbooks through your own Microsoft Entra app.
            </Text>
          </div>

          <Badge variant="light" color={badge.color}>
            {badge.label}
          </Badge>
        </Group>

        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Redirect URI:{" "}
            <Code className="settings-code-break">
              {config?.redirectUri || "Loading..."}
            </Code>
          </Text>
          <Text size="xs" c="dimmed">
            Add this URI to the Microsoft Entra app registration before
            connecting.
          </Text>
        </Stack>

        <TextInput
          label="Tenant ID"
          placeholder="contoso.onmicrosoft.com or tenant GUID"
          value={draftTenantId}
          onChange={(event) => setDraftTenantId(event.currentTarget.value)}
          autoComplete="off"
        />

        <TextInput
          label="Application client ID"
          placeholder="00000000-0000-0000-0000-000000000000"
          value={draftClientId}
          onChange={(event) => setDraftClientId(event.currentTarget.value)}
          autoComplete="off"
        />

        <Textarea
          label="Microsoft Graph scopes"
          minRows={2}
          autosize
          value={draftScopes}
          onChange={(event) => setDraftScopes(event.currentTarget.value)}
          autoComplete="off"
        />

        {authStatus?.error && !error ? (
          <Text size="xs" c={authStatus.configMissing ? "dimmed" : "orange"}>
            {authStatus.error}
          </Text>
        ) : null}

        {error ? (
          <Text size="xs" c="red">
            {error}
          </Text>
        ) : null}

        <Group>
          <Button
            onClick={() => void saveConfig()}
            disabled={
              !draftTenantId.trim() || !draftClientId.trim() || !hasUnsavedChanges
            }
            loading={loadingAction === "save"}
          >
            Save Excel Settings
          </Button>

          <Button
            variant="default"
            onClick={() => void connectMicrosoftExcel()}
            disabled={!isConfigured || hasUnsavedChanges}
            loading={loadingAction === "connect"}
          >
            Connect Excel
          </Button>

          <Button
            variant="default"
            onClick={() => void refreshConfig()}
            loading={loadingAction === "refresh"}
          >
            Refresh
          </Button>

          <Button
            variant="subtle"
            color="gray"
            onClick={() => void resetConfig()}
            disabled={!isConfigured}
            loading={loadingAction === "reset"}
          >
            Reset
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
