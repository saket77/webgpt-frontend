import { Button, Card, Group, Stack, Text, Textarea } from "@mantine/core";
import { useAgentUX } from "../../providers";

type RunAgentHumanHintCardProps = {
  onSendHint: () => void;
};

export function RunAgentHumanHintCard({
  onSendHint,
}: RunAgentHumanHintCardProps) {
  const { hint, setHint, busyAction } = useAgentUX();

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={700}>Human Assist</Text>

        <Textarea
          label="Hint / note"
          placeholder="Add guidance for the agent. If you changed the page manually, describe what you did before resuming..."
          value={hint}
          onChange={(e) => setHint(e.currentTarget.value)}
          minRows={3}
        />

        <Group>
          <Button
            variant="light"
            onClick={onSendHint}
            loading={busyAction === "hint"}
          >
            Resume With Input
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
