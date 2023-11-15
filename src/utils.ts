// Copyright © Aptos Foundation
// SPDX-License-Identifier: Apache-2.0

import { AccountAddress, Hex, TypeTag, MoveModule, MoveModuleBytecode, Aptos } from "@aptos-labs/ts-sdk";
import pako from "pako";
import { toClassString, toTypeTagEnum } from "./code-gen/index.js";
import fs from "fs";

export function toPascalCase(input: string): string {
  return input
    .split("_")
    .map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase())
    .join("");
}

export function toCamelCase(input: string): string {
  const pascalCase = toPascalCase(input);
  return pascalCase[0].toLowerCase() + pascalCase.slice(1);
}

/**
 * Convert a module source code in gzipped hex string to plain text
 * @param source module source code in gzipped hex string
 * @returns original source code in plain text
 */
export function transformCode(source: string): string {
  return pako.ungzip(Hex.fromHexInput(source).toUint8Array(), { to: "string" });
}

export async function fetchModuleABIs(aptos: Aptos, accountAddress: AccountAddress) {
  const moduleABIs = await aptos.getAccountModules({
    accountAddress: accountAddress.toString(),
  });
  return moduleABIs;
}

export function isAbiDefined(obj: MoveModuleBytecode): obj is { bytecode: string; abi: MoveModule } {
  return obj.abi !== undefined;
}

export function toClassesString(typeTags: Array<TypeTag>): string {
  if (typeTags.length === 0) {
    return "";
  }
  if (typeTags.length === 1) {
    const typeTagEnum = toTypeTagEnum(typeTags[0]);
    return toClassString(typeTagEnum);
  }
  let typeTagString = toTypeTagEnum(typeTags[typeTags.length - 1]).toString();
  for (let i = typeTags.length - 2; i >= 0; i -= 1) {
    const typeTagEnum = toTypeTagEnum(typeTags[i]);
    typeTagString = `${toClassString(typeTagEnum)}<${typeTagString}>`;
  }
  return typeTagString;
}

export function truncateAddressForFileName(address: AccountAddress) {
  const addressString = address.toString();
  return `Module_0x${addressString.slice(2, 8)}` as const;
}

export function numberToLetter(num: number): string {
  // Check if the number corresponds to the letters in the English alphabet
  if (num < 1 || num > 26) {
    throw new Error("Number out of range. Please provide a number between 1 and 26.");
  }

  // 64 is the ASCII code right before 'A'; therefore, adding the number gives the corresponding letter
  return String.fromCharCode(64 + num);
}

export function copyCode(readPath: string, writePath: string, sdkPath = "@aptos-labs/ts-sdk") {
  if (fs.existsSync(readPath)) {
    const contents = fs.readFileSync(readPath, "utf8");
    // TODO: uhh fix this later, replacing both ../ and .. versions of the import
    const newContents = contents
      .replace(`from "../..";`, `from "${sdkPath}";`)
      .replace(`from "../../";`, `from "${sdkPath}";`);

    if (fs.existsSync(writePath)) {
      fs.rmSync(writePath);
    }
    fs.writeFileSync(writePath, newContents, "utf8");
  }
}

/**
 * Sleep the current thread for the given amount of time
 * @param timeMs time in milliseconds to sleep
 */
export async function sleep(timeMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeMs);
  });
}
