import { Button, Card, Group, Stack, Text, Textarea } from "@mantine/core";
import { useAgentUX } from "../../providers";

type RunAgentControlPanelProps = {
  goal: string;
  setGoal: (value: string) => void;
  artifactFileName: string | null;
  canStart: boolean;
  canStop: boolean;
  canRefresh: boolean;
  canAttach: boolean;
  canReset: boolean;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onAttachToActiveTab: () => void;
  onReset: () => void;
};

export function RunAgentControlPanel({
  goal,
  setGoal,
  artifactFileName,
  canStart,
  canStop,
  canRefresh,
  canAttach,
  canReset,
  onStart,
  onStop,
  onRefresh,
  onAttachToActiveTab,
  onReset,
}: RunAgentControlPanelProps) {
  const { busyAction } = useAgentUX();

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Textarea
          label="Goal"
          placeholder="Find the cheapest train from NYC to Philly"
          value={goal}
          onChange={(e) => setGoal(e.currentTarget.value)}
          minRows={4}
        />

        <Text size="xs" c="dimmed">
          Selected artifact: {artifactFileName || "none"}
        </Text>

        <Group>
          <Button
            onClick={onStart}
            disabled={!canStart}
            loading={busyAction === "start"}
          >
            Start
          </Button>

          <Button
            variant="outline"
            color="red"
            onClick={onStop}
            disabled={!canStop}
            loading={busyAction === "stop"}
          >
            Stop
          </Button>

          <Button
            variant="default"
            onClick={onRefresh}
            disabled={!canRefresh}
            loading={busyAction === "refresh"}
          >
            Refresh Session
          </Button>

          <Button
            variant="default"
            onClick={onAttachToActiveTab}
            disabled={!canAttach}
            loading={busyAction === "attach"}
          >
            Attach To Active Tab
          </Button>

          <Button
            variant="subtle"
            color="gray"
            onClick={onReset}
            disabled={!canReset}
            loading={busyAction === "reset"}
          >
            Reset Session
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
