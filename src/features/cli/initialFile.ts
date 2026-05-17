import { getMatches } from "@tauri-apps/plugin-cli";
import { fileFailure } from "../files/markdownFiles";
import type { FileFailure } from "../files/types";

export interface InitialFileResult {
  path: string | null;
  warning: FileFailure | null;
}

export async function getInitialFilePath(): Promise<InitialFileResult> {
  const matches = await getMatches();
  const value = matches.args.file?.value;
  const paths =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [];

  if (paths.length === 0) {
    return { path: null, warning: null };
  }

  return {
    path: paths[0],
    warning:
      paths.length > 1
        ? fileFailure(
            "too-many-startup-files",
            "Only one file can be opened at startup.",
          )
        : null,
  };
}
