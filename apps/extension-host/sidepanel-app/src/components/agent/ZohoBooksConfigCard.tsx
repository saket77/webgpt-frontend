import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useZohoBooksConfiguration } from "../../hooks/useZohoBooksConfiguration";

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

export function ZohoBooksConfigCard() {
  const {
    config,
    authStatus,
    draftDataCenter,
    setDraftDataCenter,
    draftClientId,
    setDraftClientId,
    draftClientSecret,
    setDraftClientSecret,
    draftScopes,
    setDraftScopes,
    error,
    loadingAction,
    hasUnsavedChanges,
    refreshConfig,
    saveConfig,
    resetConfig,
    connectZohoBooks,
  } = useZohoBooksConfiguration();

  const badge = authBadge(authStatus?.authStatus);
  const isConfigured = Boolean(config?.configured);
  const dataCenterOptions = (config?.dataCenterOptions || []).map((option) => ({
    value: option.id,
    label: `${option.label} (.${option.id})`,
  }));

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600} size="sm">
              Zoho Books
            </Text>
            <Text size="xs" c="dimmed">
              Fetch audit source snapshots through a Zoho API Console OAuth client.
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
            Add this URI to the Zoho API Console client before connecting.
          </Text>
        </Stack>

        <Select
          label="Zoho data center"
          data={dataCenterOptions}
          value={draftDataCenter}
          onChange={(value) => setDraftDataCenter(value || "in")}
        />

        <TextInput
          label="Client ID"
          value={draftClientId}
          onChange={(event) => setDraftClientId(event.currentTarget.value)}
          autoComplete="off"
        />

        <TextInput
          label="Client secret"
          type="password"
          value={draftClientSecret}
          onChange={(event) => setDraftClientSecret(event.currentTarget.value)}
          autoComplete="off"
        />

        <Textarea
          label="Zoho Books scopes"
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
              !draftClientId.trim() ||
              !draftClientSecret.trim() ||
              !hasUnsavedChanges
            }
            loading={loadingAction === "save"}
          >
            Save Zoho Settings
          </Button>

          <Button
            variant="default"
            onClick={() => void connectZohoBooks()}
            disabled={!isConfigured || hasUnsavedChanges}
            loading={loadingAction === "connect"}
          >
            Connect Zoho
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
