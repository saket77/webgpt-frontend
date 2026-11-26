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
    draftMintToken,
    setDraftMintToken,
    error,
    loadingAction,
    hasOverride,
    hasUnsavedChanges,
    supportsLocalMint,
    refreshConfig,
    saveConfig,
    useLocalhostConfig: setLocalhostConfig,
    resetConfig,
    updateMintToken,
  } = useBackendConfiguration();
  const isBusy = loadingAction !== null;
  const mintTokenDisabled = isBusy || hasUnsavedChanges;

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
          disabled={isBusy}
        />

        {error ? (
          <Text size="xs" c="red">
            {error}
          </Text>
        ) : null}

        <Group>
          <Button
            onClick={() => void saveConfig()}
            disabled={isBusy || !draftBaseUrl.trim() || !hasUnsavedChanges}
            loading={loadingAction === "save"}
          >
            Save Backend URL
          </Button>

          <Button
            variant="default"
            onClick={() => void setLocalhostConfig()}
            disabled={isBusy}
            loading={loadingAction === "localhost"}
          >
            Use Localhost
          </Button>

          <Button
            variant="default"
            onClick={() => void refreshConfig()}
            disabled={isBusy}
            loading={loadingAction === "refresh"}
          >
            Refresh
          </Button>

          <Button
            variant="subtle"
            color="gray"
            onClick={() => void resetConfig()}
            disabled={isBusy || !hasOverride}
            loading={loadingAction === "reset"}
          >
            Reset To Default
          </Button>
        </Group>

        {config?.mintTokenProvisioned && (
          <Text size="xs" c="dimmed" role="status">Local mint configured</Text>
        )}
        {supportsLocalMint && !config?.mintTokenProvisioned && (
          <Stack gap="xs">
            <TextInput
              label="Local Mint Token"
              description="Authorizes Pomerado for this backend until the browser or extension restarts."
              type="password"
              autoComplete="off"
              maxLength={4096}
              value={draftMintToken}
              onChange={(event) => setDraftMintToken(event.currentTarget.value)}
              disabled={mintTokenDisabled}
            />
            <Group gap="xs">
              <Button
                onClick={() => void updateMintToken(draftMintToken.trim())}
                disabled={mintTokenDisabled || !draftMintToken.trim()}
                loading={loadingAction === "saveMint"}
              >
                Save Mint Token
              </Button>
              {config?.mintTokenConfigured && (
                <>
                  <Button
                    variant="subtle"
                    onClick={() => void updateMintToken("")}
                    disabled={mintTokenDisabled}
                    loading={loadingAction === "removeMint"}
                  >
                    Remove Token
                  </Button>
                  <Text size="xs" c="dimmed" role="status">Token configured</Text>
                </>
              )}
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
