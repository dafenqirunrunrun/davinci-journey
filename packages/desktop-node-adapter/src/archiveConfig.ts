import { readFile } from "node:fs/promises";
import { parseArchiveProfilesConfig } from "@davinci-journey/classification";

export async function readArchiveProfilesConfig(filePath: string) {
  return parseArchiveProfilesConfig(await readFile(filePath, "utf8"));
}
