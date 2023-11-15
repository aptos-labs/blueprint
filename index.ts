#!/usr/bin/env node

import { lightBlue } from "kolorist";
import { CodeGenerator, getCodeGenConfig } from "./src/index.js";
import { Aptos, AptosConfig, Network, AccountAddress } from "@aptos-labs/ts-sdk";
import { Selections, userInputs } from "./src/workflow.js";

console.log(
    lightBlue(`
                                                                               ./&@@@@@%*                   /%@@@#,
            @@.               #@@@@@@@@@@@@@*   (@@@@@@@@@@@@@@@@@@@@%     *@@@@@@@@@@@@@@@@@           *@@@@/..,@@@@@
           @@@@/              #@@*        /@@@           /@@(            /((((((((((((((*   *((*       ,@@@         %
          @@/ @@&             #@@*         @@@,          /@@(                         (@               .@@@
        ,@@,   &@@            #@@*         @@@           /@@(          @@@@@@@@@@@@@@@@@@@@@@@@@@@      .@@@@&.
       (@@      /@@           #@@#////#%@@@@&            /@@(                                              ,@@@@@@&
      %@@        .@@,         #@@@&&&&&&/                /@@(                    @@,                             &@@@@.
     @@@@@@@@@@@@@@@@#        #@@*                       /@@(          @@@@@@@@@%@@@@@@@@@@@@@@@@&                  @@@%
    @@%             @@@       #@@*                       /@@(                                            ,          .@@@
  .@@&               @@@      #@@*                       /@@(              &@@/                        @@@@        .@@@,
 #@@%                 @@@     #@@*                       /@@(               .@@@@@@@@@@@@@@@             %@@@@@@@@@@@/
`)
);
console.log("Welcome to the Aptos Blueprint wizard 🔮");

async function main() {
    // const selections = await userInputs();
    const selections: Selections = {
        configPath: "./tests/config.yaml",
        additionalModules: [ AccountAddress.fromRelaxed("0x74007b85705153d40b88f994876fd2f7e12204f79527b44f71e69a9d34644f18") ],
        frameworkModules: [ AccountAddress.ONE, AccountAddress.THREE, AccountAddress.FOUR ], 
        // frameworkModules: [],
        network: Network.LOCAL,
    }
    console.log(selections.configPath);
    const codeGeneratorConfig = getCodeGenConfig(selections.configPath);
    console.log(lightBlue(JSON.stringify(codeGeneratorConfig, null, 3)));
    const codeGenerator = new CodeGenerator(codeGeneratorConfig);
    const aptosConfig = new AptosConfig({ network: selections.network });
    const aptos = new Aptos(aptosConfig);
    await codeGenerator.generateCodeForModules(
        aptos,
        [...selections.frameworkModules, ...selections.additionalModules],
    );
}

main().catch((e) => {
    console.error(e);
});
