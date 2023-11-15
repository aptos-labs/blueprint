import { red } from "kolorist";
import prompts from "prompts";
import { Network, AccountAddress } from "@aptos-labs/ts-sdk";
import fs from "fs";

export type Selections = {
  configPath: string;
  frameworkModules: Array<AccountAddress>;
  additionalModules: Array<AccountAddress>;
  network: Network;
};

export function validateConfigPath(value: string) {
  const exists = fs.existsSync(value);
  const isYaml = value.endsWith(".yaml");
  if (exists && isYaml) {
    return true;
  }
  const doesntExistMessage = exists ? "" : "File does not exist. ";
  const isYamlMessage = isYaml ? "" : `${doesntExistMessage.length > 0 ? "and " : ""}${value} is not a yaml file. `;
  return `Please enter a valid config.yaml file path. ${doesntExistMessage} ${isYamlMessage}`;
}

export function validateAddresses(value: string) {
  const addresses = value.split(",");
  const valid = addresses.every((address) => {
    try {
      AccountAddress.fromStringRelaxed(address);
      return true;
    } catch (err) {
      return false;
    }
  });
  if (valid) {
    return true;
  }
  return "Please enter a valid comma separated list of addresses";
}

export function validateNetwork(value: string) {
  const valid = Object.values(Network).includes(value as Network);
  if (valid) {
    return true;
  }
  return "Please enter a valid network";
}

export async function userInputs() {
  let result: prompts.Answers<"configPath" | "frameworkModules" | "additionalModules" | "network">;

  try {
    result = await prompts(
      [
        {
          type: "text",
          name: "configPath",
          message: "Your config.yaml file path",
          initial: "./config.yaml",
          validate: (value: string) => validateConfigPath(value),
        },
        {
          type: "multiselect",
          name: "frameworkModules",
          message: "What framework modules would you like to generate code for?",
          choices: [
            {
              title: "0x1",
              value: AccountAddress.ONE,
              description:
                "The aptos framework modules. This includes account.move, aptos_account.move, code.move, etc.",
            },
            {
              title: "0x3",
              value: AccountAddress.THREE,
              description: "The old token.move modules for creating and interacting with legacy tokens.",
            },
            {
              title: "0x4",
              value: AccountAddress.FOUR,
              description: "The new Aptos Token Object modules for creating and interacting with token objects.",
            },
          ],
          hint: "- Space to select. Press enter to submit",
        },
        {
          type: "text",
          name: "additionalModules",
          message: "What additional modules would you like to generate code for?",
          initial: "",
          separator: ",",
          hint: "- Comma separated list. Press enter to submit",
          validate: (value: string) => validateAddresses(value),
        },
        {
          type: "text",
          name: "network",
          message: "What network do you want to get the module ABIs from?",
          initial: "devnet",
          validate: (value: string) => validateNetwork(value),
        },
      ],
      {
        onCancel: () => {
          throw new Error(red("✖") + " Operation cancelled");
        },
      },
    );
  } catch (err: any) {
    console.log(err.message);
    process.exit(0);
  }

  const { configPath, frameworkModules, additionalModules, network } = result;
  return {
    configPath,
    frameworkModules,
    additionalModules,
    network,
  } as Selections;
}
