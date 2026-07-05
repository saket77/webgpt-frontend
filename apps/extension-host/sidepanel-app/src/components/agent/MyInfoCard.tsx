import {
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@mantine/core";
import { useMyInfoConfiguration } from "../../hooks/useMyInfoConfiguration";

export function MyInfoCard() {
  const {
    draftEnabledForRuns,
    setDraftEnabledForRuns,
    draftText,
    setDraftText,
    runActive,
    error,
    loadingAction,
    hasUnsavedChanges,
    refreshConfig,
    saveConfig,
    clearConfig,
  } = useMyInfoConfiguration();

  return (
    <Card className="my-info-card" withBorder radius="md" p="md">
      <Stack className="my-info-card-scroll" gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600} size="sm">
              My Info
            </Text>
            <Text size="xs" c="dimmed">
              Optional free-form details WebGPT can use while filling forms or
              working with your files.
            </Text>
          </div>

          <Badge variant="light" color={draftEnabledForRuns ? "green" : "gray"}>
            {draftEnabledForRuns ? "Enabled" : "Off"}
          </Badge>
        </Group>

        <Switch
          label="Use My Info in this run"
          checked={draftEnabledForRuns}
          disabled={runActive}
          onChange={(event) =>
            setDraftEnabledForRuns(event.currentTarget.checked)
          }
        />

        {runActive ? (
          <Text size="xs" c="dimmed">
            A run is active, so this toggle is locked until the run ends.
          </Text>
        ) : null}

        <Textarea
          className="my-info-input"
          label="Free-form info"
          description="Examples: name, email, phone, address, LinkedIn, work authorization, resume notes, default application answers."
          minRows={6}
          maxRows={12}
          autosize
          value={draftText}
          onChange={(event) => setDraftText(event.currentTarget.value)}
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
            disabled={!hasUnsavedChanges}
            loading={loadingAction === "save"}
          >
            Save
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
            onClick={() => void clearConfig()}
            disabled={!draftText.trim() && !draftEnabledForRuns}
            loading={loadingAction === "clear"}
          >
            Clear
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
