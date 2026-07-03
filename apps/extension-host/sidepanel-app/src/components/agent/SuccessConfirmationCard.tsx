import { Button, Card, Group, Stack, Text } from "@mantine/core";
import { useAgentUX } from "../../providers";

type SuccessConfirmationCardProps = {
  description: string;
  onAccept: () => void;
  onReject: () => void;
};

export function SuccessConfirmationCard({
  description,
  onAccept,
  onReject,
}: SuccessConfirmationCardProps) {
  const { busyAction } = useAgentUX();

  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={700}>Success confirmation required</Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>

        <Group>
          <Button
            color="green"
            onClick={onAccept}
            loading={busyAction === "acceptSuccess"}
            disabled={busyAction === "acceptSuccess"}
          >
            Accept Success
          </Button>

          <Button
            color="red"
            variant="light"
            onClick={onReject}
            loading={busyAction === "rejectSuccess"}
            disabled={busyAction === "rejectSuccess"}
          >
            Reject Success
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
