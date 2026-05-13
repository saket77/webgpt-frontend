import {
  Button,
  Card,
  Divider,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";

type TemplateInput = {
  key: string;
  label?: string;
};

type TemplateControlPanelProps = {
  inputSchema: TemplateInput[];
  inputValues: Record<string, string[]>;
  currentIndex: number;
  totalRuns: number;
  renderedGoal: string;
  isRunning: boolean;
  busyAction: string | null;
  queueMode: boolean;
  canStart: boolean;
  canMoveIndex: boolean;
  onInputChange: (key: string, index: number, value: string) => void;
  onAddValue: (key: string) => void;
  onRemoveValue: (key: string, index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onStartCurrent: () => void;
  onStartQueue: () => void;
  onStop: () => void;
};

export function TemplateControlPanel({
  inputSchema,
  inputValues,
  currentIndex,
  totalRuns,
  renderedGoal,
  isRunning,
  busyAction,
  queueMode,
  canStart,
  canMoveIndex,
  onInputChange,
  onAddValue,
  onRemoveValue,
  onPrevious,
  onNext,
  onStartCurrent,
  onStartQueue,
  onStop,
}: TemplateControlPanelProps) {
  return (
    <Card className="template-control-panel" withBorder radius="md" p="md">
      <Stack gap="md">
        <Text fw={700}>Inputs</Text>

        {inputSchema.length === 0 ? (
          <Text size="sm" c="dimmed">
            This template does not require inputs.
          </Text>
        ) : (
          inputSchema.map((input) => {
            const values = inputValues[input.key] || [""];

            return (
              <Stack key={input.key} gap="xs">
                <Text size="sm" fw={600}>
                  {input.label || input.key}
                </Text>

                {values.map((value, index) => (
                  <Group key={`${input.key}-${index}`} align="flex-end">
                    <TextInput
                      style={{ flex: 1 }}
                      value={value}
                      onChange={(e) =>
                        onInputChange(input.key, index, e.currentTarget.value)
                      }
                      placeholder={input.label || input.key}
                      disabled={isRunning}
                    />

                    <Button
                      variant="light"
                      color="red"
                      size="xs"
                      onClick={() => onRemoveValue(input.key, index)}
                      disabled={isRunning}
                    >
                      Remove
                    </Button>
                  </Group>
                ))}

                <Group>
                  <Button
                    variant="light"
                    size="xs"
                    onClick={() => onAddValue(input.key)}
                    disabled={isRunning}
                  >
                    Add another
                  </Button>
                </Group>
              </Stack>
            );
          })
        )}

        <Divider />

        <Group>
          <Button
            variant="default"
            onClick={onPrevious}
            disabled={!canMoveIndex || currentIndex === 0}
          >
            Previous
          </Button>

          <Button
            variant="default"
            onClick={onNext}
            disabled={!canMoveIndex || currentIndex >= totalRuns - 1}
          >
            Next
          </Button>
        </Group>

        <Stack gap={4}>
          <Text fw={700} size="sm">
            Runtime goal preview
          </Text>
          <Text size="sm" c="dimmed">
            {renderedGoal || "No goal preview available"}
          </Text>
        </Stack>

        <Group>
          <Button
            onClick={onStartCurrent}
            disabled={!canStart}
            loading={busyAction === "start" && !queueMode}
          >
            Start Current
          </Button>

          <Button
            variant="light"
            onClick={onStartQueue}
            disabled={!canStart}
            loading={busyAction === "start" && queueMode}
          >
            Start Queue
          </Button>

          <Button
            variant="outline"
            color="red"
            onClick={onStop}
            disabled={busyAction === "stop"}
            loading={busyAction === "stop"}
          >
            Stop
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
