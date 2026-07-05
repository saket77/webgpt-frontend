import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useBackendConfiguration } from "../../hooks/useBackendConfiguration";

export function BackendConfigCard() {
  const {
    config,
    draftBaseUrl,
    setDraftBaseUrl,
    error,
    loadingAction,
    hasOverride,
    hasUnsavedChanges,
    refreshConfig,
    saveConfig,
    useLocalhostConfig: setLocalhostConfig,
    resetConfig,
  } = useBackendConfiguration();

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600} size="sm">
              Backend
            </Text>
            <Text size="xs" c="dimmed">
              WebGPT uses the hosted planner by default. Override this only for
              local development or a compatible custom backend.
            </Text>
          </div>

          <Badge variant="light" color={hasOverride ? "blue" : "gray"}>
            {hasOverride ? "Custom URL" : "Default URL"}
          </Badge>
        </Group>

        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Active backend: <Code>{config?.baseUrl || "Loading..."}</Code>
          </Text>
          <Text size="xs" c="dimmed">
            Default planner:{" "}
            <Code>
              {config?.defaultBaseUrl ||
                "https://webgpt-backend-production.up.railway.app"}
            </Code>
          </Text>
        </Stack>

        <TextInput
          label="Backend base URL"
          placeholder="http://localhost:8787"
          value={draftBaseUrl}
          onChange={(event) => setDraftBaseUrl(event.currentTarget.value)}
          autoComplete="off"
        />

        {error ? (
          <Text size="xs" c="red">
            {error}
          </Text>
        ) : null}

        <Group>
          <Button
            onClick={() => void saveConfig()}
            disabled={!draftBaseUrl.trim() || !hasUnsavedChanges}
            loading={loadingAction === "save"}
          >
            Save Backend URL
          </Button>

          <Button
            variant="default"
            onClick={() => void setLocalhostConfig()}
            loading={loadingAction === "localhost"}
          >
            Use Localhost
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
            disabled={!hasOverride}
            loading={loadingAction === "reset"}
          >
            Reset To Default
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
