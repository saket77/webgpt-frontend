import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  useSavedArtifacts,
  type SavedArtifactSummary,
} from "../hooks/useSavedArtifacts";

type SavedArtifactsPageProps = {
  onOpenArtifact: (artifact: SavedArtifactSummary) => void;
};

function formatDate(value?: string) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function SavedArtifactsPage({
  onOpenArtifact,
}: SavedArtifactsPageProps) {
  const { artifacts, loading, error, refresh } = useSavedArtifacts(true);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>Saved Templates</Title>
        <Button size="xs" variant="light" onClick={() => void refresh()}>
          Refresh
        </Button>
      </Group>

      {loading ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : null}

      {!loading && error ? (
        <Alert color="red" title="Could not load saved templates">
          {error}
        </Alert>
      ) : null}

      {!loading && !error && artifacts.length === 0 ? (
        <Alert color="gray" title="No saved templates yet">
          Save a successful replay artifact first, then it will show up here.
        </Alert>
      ) : null}

      {!loading &&
        !error &&
        artifacts.map((artifact, index) => {
          const inputCount = Array.isArray(artifact.inputSchema)
            ? artifact.inputSchema.length
            : 0;

          return (
            <Card
              key={`${artifact.successfulReplayArtifactFileName || artifact.goal}-${index}`}
              withBorder
              padding="sm"
              radius="md"
            >
              <Stack gap={8}>
                <div>
                  <Text fw={600} size="sm">
                    {artifact.goal || "Untitled template"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {artifact.description || "No description available"}
                  </Text>
                </div>

                <Stack gap={2}>
                  <Text size="xs" c="dimmed">
                    Replay artifact:{" "}
                    {artifact.successfulReplayArtifactFileName || "—"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Inputs required: {inputCount}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Updated: {formatDate(artifact.updatedAt)}
                  </Text>
                </Stack>

                <Group justify="flex-end">
                  <Button
                    size="xs"
                    disabled={!artifact.successfulReplayArtifactFileName}
                    onClick={() => onOpenArtifact(artifact)}
                  >
                    Open Template
                  </Button>
                </Group>
              </Stack>
            </Card>
          );
        })}
    </Stack>
  );
}
