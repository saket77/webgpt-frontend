import { Alert } from "@mantine/core";
import { useAgentUX } from "../../providers";

export function ErrorAlert() {
  const { error } = useAgentUX();

  if (!error) return null;

  return (
    <Alert color="red" title="Error">
      {error}
    </Alert>
  );
}
