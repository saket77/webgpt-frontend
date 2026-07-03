import {
  Alert,
  Badge,
  Button,
  Box,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
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
    <Paper className="chat-surface routines-surface" withBorder>
      <Stack className="chat-layout" gap={0}>
        <Group className="chat-toolbar" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Box>
              <Text fw={800} size="lg" lh={1}>
                Routines
              </Text>
              <Text size="xs" c="dimmed" mt={3}>
                Reuse saved WebGPT flows
              </Text>
            </Box>
          </Group>
          <Button
            radius="xl"
            variant="light"
            color="violet"
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        </Group>

        <ScrollArea className="chat-scroll" offsetScrollbars>
          <Stack gap="md" p="md">
            <Paper className="routine-intro">
              <Text fw={800} size="xl">
                My routines
              </Text>
              <Text size="sm" c="dimmed" mt={6}>
                Pick a saved replay and run it through the same WebGPT chat
                surface.
              </Text>
            </Paper>

            {loading ? (
              <Group justify="center" py="xl">
                <Loader color="violet" />
              </Group>
            ) : null}

            {!loading && error ? (
              <Alert color="red" title="Could not load routines">
                {error}
              </Alert>
            ) : null}

            {!loading && !error && artifacts.length === 0 ? (
              <Alert color="gray" title="No routines yet">
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
                  <button
                    key={`${artifact.successfulReplayArtifactFileName || artifact.goal}-${index}`}
                    className="routine-row"
                    type="button"
                    disabled={!artifact.successfulReplayArtifactFileName}
                    onClick={() => onOpenArtifact(artifact)}
                  >
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Stack gap={5}>
                        <Text fw={800} size="md" lineClamp={1}>
                          {artifact.goal || "Untitled routine"}
                        </Text>
                        <Text size="sm" c="dimmed" lineClamp={2}>
                          {artifact.description || "No description available"}
                        </Text>
                        <Group gap={8} mt={4}>
                          <Badge variant="light" color="violet">
                            {inputCount} input{inputCount === 1 ? "" : "s"}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {formatDate(artifact.updatedAt)}
                          </Text>
                        </Group>
                      </Stack>
                      <Text c="dimmed" fw={800}>
                        &gt;
                      </Text>
                    </Group>
                  </button>
                );
              })}
          </Stack>
        </ScrollArea>
      </Stack>
    </Paper>
  );
}
