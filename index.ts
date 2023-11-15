#!/usr/bin/env node

import { lightBlue } from "kolorist";
import { CodeGenerator, getCodeGenConfig } from "./src/index.js";
import { AccountAddress, Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { userInputs } from "./src/workflow.js";

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
    const selections = await userInputs();
    const codeGeneratorConfig = getCodeGenConfig(selections.configPath);
    const codeGenerator = new CodeGenerator(codeGeneratorConfig);
    const network = Network.DEVNET;
    const aptosConfig = new AptosConfig({ network });
    const aptos = new Aptos(aptosConfig);
    await codeGenerator.generateCodeForModules(
        aptos,
        selections.frameworkModules.concat(selections.additionalModules),
    );
}

main().catch((e) => {
    console.error(e);
});
