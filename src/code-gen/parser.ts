// Copyright © Aptos Foundation
// SPDX-License-Identifier: Apache-2.0

import {
  AccountAddress,
  Aptos,
  MoveFunctionGenericTypeParam,
  TypeTag,
  parseTypeTag,
  TypeTagVector,
  TypeTagAddress,
} from "@aptos-labs/ts-sdk";
import { getArgNameMapping, getMoveFunctionsWithArgumentNames, getSourceCodeMap } from "./packageMetadata.js";
import {
  ABIGeneratedCodeMap,
  AbiFunctions,
  AnnotatedBCSArgument,
  EntryFunctionArgumentSignature,
  codeGeneratorOptions,
  fetchModuleABIs,
  isAbiDefined,
  toFlattenedTypeTag,
  toPascalCase,
  truncateAddressForFileName,
  truncatedTypeTagString,
  copyCode,
  TypeTagEnum,
  toClassString,
  toClassesString,
  toInputTypeString,
  transformEntryFunctionInputTypes,
  transformViewFunctionInputTypes,
  isSignerReference,
  IMPORT_ACCOUNT_ADDRESS,
  PRIMARY_SENDER_FIELD_NAME,
  FEE_PAYER_FIELD_NAME,
  SECONDARY_SENDERS_FIELD_NAME,
  MODULE_ADDRESS_FIELD_NAME,
  R_PARENTHESIS,
} from "../index.js";
import fs from "fs";
import { ConfigDictionary } from "./config.js";
import { format } from "prettier";
import {
  DEFAULT_ARGUMENT_BASE,
  FOR_GENERATION_DIRECTORY,
  PAYLOAD_BUILDERS_FILE_NAME,
  ABI_TYPES_FILE_NAME,
  getBoilerplateImports,
  BOILERPLATE_COPYRIGHT,
} from "../index.js";
import { blue, red, yellow, green, white, lightGreen, ansi256Bg, ansi256 } from "kolorist";

export class CodeGenerator {
  public readonly config: ConfigDictionary;

  constructor(config: ConfigDictionary) {
    this.config = config;
  }

  // Note that the suppliedFieldNames includes the `&signer` and `signer` fields.
  metaclassBuilder(args: codeGeneratorOptions): string {
    const {
      moduleAddress,
      moduleName,
      functionName,
      className,
      typeTags,
      genericTypeTags,
      displaySignerArgsAsComments,
      suppliedFieldNames,
      visibility,
      genericTypeParams,
      documentation,
    } = args;
    const viewFunction = args.viewFunction ?? false;
    const fieldNames = suppliedFieldNames ?? [];

    // Check if the user supplied field names
    // If they're undefined or length 0, generate them
    if (fieldNames === undefined || fieldNames.length === 0) {
      for (let i = 0; i < typeTags.length; i += 1) {
        fieldNames.push(`${DEFAULT_ARGUMENT_BASE}${i}`);
      }
      // otherwise, ensure that the array lengths match
    } else if (fieldNames.length !== typeTags.length) {
      console.log(
        moduleAddress.toString(),
        moduleName,
        functionName,
        fieldNames,
        typeTags.map((t) => t.toString()),
      );
      throw new Error(`fieldNames.length (${fieldNames.length}) !== typeTags.length (${typeTags.length})`);
    }

    // --------------- Handle signers --------------- //
    // console.log(genericTypeTags);
    // Get the array of annotated BCS class names, their string representation, and original TypeTag string
    const { signerArguments, functionArguments, genericsWithAbilities } = this.getClassArgTypes(
      typeTags,
      genericTypeParams,
    );
    const lines: Array<string> = [];

    const argsType = `${className}PayloadMoveArguments`;
    const signerArgumentNames = suppliedFieldNames ? suppliedFieldNames.splice(0, signerArguments.length) : [];
    const joinedGenericsWithAbilities = genericsWithAbilities.join(", ");

    // ---------- Declare class field types separately ---------- //
    if (functionArguments.length > 0) {
      lines.push(`export type ${argsType} = {`);
      functionArguments.forEach((functionArgument, i) => {
        if (viewFunction) {
          const viewFunctionInputTypeConverter = toInputTypeString(functionArgument.typeTagArray, viewFunction);
          lines.push(`${fieldNames[i]}: ${viewFunctionInputTypeConverter};`);
        } else {
          lines.push(`${fieldNames[i]}: ${functionArgument.classString};`);
        }
      });
      lines.push("}");
    }
    lines.push("");

    // ---------- Documentation --------- //
    const atleastOneGeneric = genericsWithAbilities.length > 0;
    const leftCaret = atleastOneGeneric ? "<" : "";
    const rightCaret = atleastOneGeneric ? ">" : "";

    if (documentation?.displayFunctionSignature) {
      lines.push("/**");
      lines.push(`*  ${visibility} fun ${functionName}${leftCaret}${joinedGenericsWithAbilities}${rightCaret}(`);
      signerArguments.forEach((signerArgument, i) => {
        lines.push(`*     ${signerArgumentNames[i]}: ${signerArgument.annotation},`);
      });
      functionArguments.forEach((functionArgument, i) => {
        lines.push(`*     ${fieldNames[i]}: ${functionArgument.annotation},`);
      });
      lines.push("*   )");
      lines.push("**/");
    }

    const accountAddressInputString = toInputTypeString([new TypeTagAddress()], viewFunction);
    const accountAddressClassString = toClassString(TypeTagEnum.AccountAddress);

    // ---------- Class fields ---------- //
    const entryOrView = viewFunction ? "View" : "Entry";
    const secondarySenders = signerArguments.slice(1).map(s => accountAddressClassString);
    const classFields = `
    export class ${className} extends ${entryOrView}FunctionPayloadBuilder {
      public readonly moduleAddress = ${MODULE_ADDRESS_FIELD_NAME};
      public readonly moduleName = "${moduleName}";
      public readonly functionName = "${functionName}";
      public readonly ${PRIMARY_SENDER_FIELD_NAME}: ${accountAddressClassString};
      public readonly ${SECONDARY_SENDERS_FIELD_NAME}: [${secondarySenders.join(', ')}]${secondarySenders.length > 0 ? "" : " = []"};
      public readonly args: ${functionArguments.length > 0 ? argsType : "{ }"};
      public readonly typeTags: Array<TypeTag> = []; ${atleastOneGeneric ? "//" : ""} ${joinedGenericsWithAbilities}
      public readonly ${FEE_PAYER_FIELD_NAME}?: ${accountAddressClassString};
    `;
    lines.push(classFields);

    // -------- Constructor input types -------- //
    // constructor fields
    const constructorSenders = new Array<string>();
    const constructorOtherArgs = new Array<string>();
    if (true) {
      lines.push(`private constructor(`);
      signerArguments.forEach((signerArgument, i) => {
        if (this.config.includeAccountParams) {
          // TODO: Add support for adding an Account directly in the constructor..?
          constructorSenders.push(`${signerArgumentNames[i]}: Account, // ${signerArgument.annotation}`);
        } else {
          // signers are `AccountAddress` in the constructor signature because we're just generating the raw transaction here.
          constructorSenders.push(`${signerArgumentNames[i]}: ${accountAddressInputString}, // ${signerArgument.annotation}`);
        }
      });
      functionArguments.forEach((functionArgument, i) => {
        const inputType = toInputTypeString(functionArgument.typeTagArray, viewFunction);
        const argComment = ` // ${functionArgument.annotation}`;
        constructorOtherArgs.push(`${fieldNames[i]}: ${inputType}, ${argComment}`);
      });
      if (genericTypeTags) {
        constructorOtherArgs.push(`typeTags: Array<TypeTagInput>, ${atleastOneGeneric ? "//" : ""} ${joinedGenericsWithAbilities}`);
      }
      if (!viewFunction) {
        if (this.config.includeAccountParams) {
          constructorOtherArgs.push("feePayer?: Account, // optional fee payer account to sponsor the transaction");
        } else {
          constructorOtherArgs.push(`feePayer?: ${accountAddressInputString}, // optional fee payer account to sponsor the transaction`);
        }
      }
      lines.push(constructorSenders.join("\n"));
      lines.push(constructorOtherArgs.join("\n"));
      lines.push(`) {`);

      // -------- Assign constructor fields to class fields -------- //
      lines.push(`super();`);
      const signerArgumentNamesAsClasses = signerArgumentNames.map((signerArgumentName) => `AccountAddress.fromRelaxed(${signerArgumentName})`);
      const primarySenderAssignment = `this.${PRIMARY_SENDER_FIELD_NAME} = ${signerArgumentNamesAsClasses[0]};`;
      const secondarySenderAssignment = `this.${SECONDARY_SENDERS_FIELD_NAME} = [${signerArgumentNamesAsClasses.slice(1).join(", ")}];`;
      lines.push(signerArguments.length >= 1 ? primarySenderAssignment : '');
      lines.push(signerArguments.length > 1 ? secondarySenderAssignment : '');
      lines.push(`this.args = {`);
      functionArguments.forEach((_, i) => {
        // Don't use BCS classes for view functions, since they don't need to be serialized
        // Although we can use them eventually when view functions accepts BCS inputs
        if (viewFunction) {
          // lines.push(`${fieldNames[i]}: ${functionArguments[i].kindArray},`);
          const viewFunctionInputTypeConverter = transformViewFunctionInputTypes(
            fieldNames[i],
            functionArguments[i].typeTagArray,
            0,
          );
          lines.push(`${fieldNames[i]}: ${viewFunctionInputTypeConverter},`);
        } else {
          const entryFunctionInputTypeConverter = transformEntryFunctionInputTypes(
            fieldNames[i],
            functionArguments[i].typeTagArray,
            0,
          );
          lines.push(`${fieldNames[i]}: ${entryFunctionInputTypeConverter},`);
        }
      });
      lines.push(`}`);
      if (genericTypeTags) {
        lines.push(
          `this.typeTags = typeTags.map(typeTag => typeof typeTag === 'string' ? parseTypeTag(typeTag) : typeTag);`,
        );
      }
      if (!viewFunction) {
        lines.push(`this.${FEE_PAYER_FIELD_NAME} = (${FEE_PAYER_FIELD_NAME} !== undefined) ? AccountAddress.fromRelaxed(${FEE_PAYER_FIELD_NAME}) : undefined;`);
      }
      lines.push(`}`);
    } else {
      // TODO: Fix no-signer entry function constructor?
      lines.push(`private constructor() { super(); this.args = { }; }`);
    }

    if (!viewFunction) {
      const buildString = this.createBuildFunction(
        Array.from(signerArguments),
        Array.from(signerArgumentNames),
        Array.from(functionArguments),
        Array.from(fieldNames),
        false,
        accountAddressInputString,
        viewFunction,
        typeTags,
      );
      lines.push(buildString);
      const buildStringWithFeePayer = this.createBuildFunction(
        Array.from(signerArguments),
        Array.from(signerArgumentNames),
        Array.from(functionArguments),
        Array.from(fieldNames),
        true,
        accountAddressInputString,
        viewFunction,
        typeTags,
      );
      lines.push(buildStringWithFeePayer);
    }
    lines.push(`\n } \n`);
    return lines.join("\n");
  }

  createBuildFunction(
    signerArguments: Array<AnnotatedBCSArgument>,
    signerArgumentNames: Array<string>,
    functionArguments: Array<AnnotatedBCSArgument>,
    fieldNames: Array<string>,
    withFeePayer: boolean,
    accountAddressInputString: string,
    viewFunction: boolean,
    typeTags: Array<TypeTag>,
  ) {
    const constructorSenders = new Array<string>();
    const constructorOtherArgs = new Array<string>();
    signerArguments.forEach((signerArgument, i) => {
      constructorSenders.push(`${signerArgumentNames[i]}: ${accountAddressInputString}, // ${signerArgument.annotation}`);
    });
    functionArguments.forEach((functionArgument, i) => {
      const inputType = toInputTypeString(functionArgument.typeTagArray, viewFunction);
      const argComment = ` // ${functionArgument.annotation}`;
      constructorOtherArgs.push(`${fieldNames[i]}: ${inputType}, ${argComment}`);
    });
    // constructorOtherArgs.push('aptosConfig: AptosConfig,');
    constructorOtherArgs.push(`feePayer?: ${accountAddressInputString}, // optional fee payer account to sponsor the transaction`);

    const conditionalComma = constructorSenders.length > 0 ? "," : "";
    const conditionalCommaSecondarySenders = constructorOtherArgs.slice(0, -1).length > 0 ? "," : "";
    const conditionalCommaFeePayer = constructorOtherArgs.length > 0 ? "," : "";

    // TODO: Fix this later
    // const rawTransactionType = `Promise<RawTransaction${(withFeePayer || withSecondarySenders) ? "WithData" : ""}>`;
    const rawTransactionType = `Promise<RawTransaction>`;
    const staticBuild = `
      static async build${withFeePayer ? "WithFeePayer" : ""}(
        ${constructorSenders.join("\n")}
        ${constructorOtherArgs.slice(0, -1).join("\n")}
        ${withFeePayer ? `feePayer: ${accountAddressInputString},` : ""}
        aptosConfig: AptosConfig,
        typeTags: Array<TypeTag>,
        options?: InputGenerateTransactionOptions,
      ): Promise<${rawTransactionType}> {
        const payloadBuilder = new this(
          ${constructorSenders.map(s => s.split(':')[0]).join(",\n")}${conditionalComma}
          ${constructorOtherArgs.slice(0, -1).map(s => s.split(':')[0]).join(",\n")}${conditionalCommaSecondarySenders}
          ${withFeePayer ? constructorOtherArgs.pop()?.split("?:")[0] + (conditionalCommaFeePayer) : ""}
        );
        const rawTransaction = (await buildTransaction({
          aptosConfig,
          sender: payloadBuilder.${PRIMARY_SENDER_FIELD_NAME},
          ${withFeePayer ? "feePayerAddress: feePayer ?? AccountAddress.ZERO," : ""}
          ${signerArguments.length > 1 ? "secondarySignerAddresses: payloadBuilder.secondarySenders," : ""}
          payload: payloadBuilder.toPayload(),
          options,
        })).rawTransaction;
        return rawTransaction;
      }
    `;
    // static build (no fee payer) will take off the last line in the constructor signature (the fee payer)
    // static buildWithFeePayer will explicitly include the feePayer, regardless of whether or not it's passed in to the static factory method. This is because
    //      we will set it to 0x0 if they don't provide it.
    return staticBuild;
  }

  getClassArgTypes(
    typeTags: Array<TypeTag>,
    genericTypeParams: Array<MoveFunctionGenericTypeParam>,
    replaceOptionWithVector = true,
  ): EntryFunctionArgumentSignature {
    const signerArguments = new Array<AnnotatedBCSArgument>();
    const functionArguments = new Array<AnnotatedBCSArgument>();
    const genericsWithAbilities = new Array<string>();
    typeTags.forEach((typeTag, i) => {
      const flattenedTypeTag = toFlattenedTypeTag(typeTag);
      let annotation = this.config.expandedStructs
        ? typeTag.toString()
        : truncatedTypeTagString({
          typeTag,
          namedAddresses: this.config.namedAddresses,
          namedTypeTags: this.config.namedTypeTags,
        });

      // TODO: Change this to Account? Or something else, not sure. But AccountAuthenticator doesn't make sense in the new flow anymore.
      // Check if it's an AccountAuthenticator, which indicates it's a signer argument
      // and we add it to the signerArguments array
      const firstTypeTag = flattenedTypeTag[0];
      if (firstTypeTag.isSigner() || isSignerReference(firstTypeTag)) {
        signerArguments.push({
          typeTagArray: [firstTypeTag],
          classString: toClassString(TypeTagEnum.Signer),
          annotation,
        });
        // It's a non-signer entry function argument, so we'll add it to the functionArguments array
      } else {
        /*
          // Check if the TypeTag is actually an Object type
          // Object<T> must have at least 2 types, so if the length is 1, it's not an Object
          const genericType = `T${genericsWithAbilities.length}`;
          const constraints = `: ${genericTypeParams[genericsWithAbilities.length]?.constraints.join(" + ") ?? ""}`;
          // 2, because that's the length of ": ". We don't add it if there are no constraints
          const genericTypeWithConstraints = constraints.length > 2 ? `${genericType}${constraints}` : genericType;
          // console.log(genericTypeWithConstraints);
          console.log(kindArray);
          console.log(expandedTypeTags.map((typeTag) => typeTag.toString()));
          const secondToLast = expandedTypeTags[expandedTypeTags.length - 2];
          if (secondToLast?.isStruct() && secondToLast?.isObject()) {
            const objectType = secondToLast.value;
            if (parseTypeTag(`${objectType.address}::${objectType.moduleName}::${objectType.name}`).isGeneric()) {
              genericsWithAbilities.push(genericTypeWithConstraints);
            } else {
              
            }
            annotation += `<${genericType}>`;
            kindArray.pop();
          }
          */

        // Check if the TypeTag is actually an Object type
        // Object<T> must have at least 2 types, so if the length is 1, it's not an Object
        if (flattenedTypeTag.length > 1) {
          const secondToLast = flattenedTypeTag[flattenedTypeTag.length - 2];
          if (flattenedTypeTag[flattenedTypeTag.length - 1].isGeneric()) {
            const genericType = `T${genericsWithAbilities.length}`;
            const constraints = `: ${genericTypeParams[genericsWithAbilities.length]?.constraints.join(" + ")}`;
            // 2, because that's the length of ": ". We don't add it if there are no constraints
            const genericTypeWithConstraints = constraints.length > 2 ? `${genericType}${constraints}` : genericType;
            // Check if the second to last kind is an AccountAddress, because that's *always* an Object
            // if (kindArray[kindArray.length - 2] === AccountAddress.kind) {
            if (secondToLast.isStruct() && secondToLast.isObject()) {
              genericsWithAbilities.push(genericTypeWithConstraints);
              // annotation += `<${genericType}>`;
              flattenedTypeTag.pop();
            } else {
              genericsWithAbilities.push(genericTypeWithConstraints);
              // The second to last kind is not an Object, so we'll add it to the functionArguments array
              // this is a generically typed argument, meaning (as of right now, 11-2023), it's a normal
              // BCS argument            // functionArguments.push({
              //   kindArray,
              //   kindString: toClassesString(kindArray),
              //   annotation,
              // });
            }
          } else if (secondToLast.isStruct() && secondToLast.isObject()) {
            // it's an Object<T> where T is not generic: aka Object<Token> or something
            // so we'll remove the second to last kind, since it's an Object
            flattenedTypeTag.pop();
          }
        }

        let endFlattenedTypeTag: Array<TypeTag> = flattenedTypeTag;

        // Replacing the Option with a Vector is useful for the constructor input types since
        // ultimately it's the same serialization, and we can restrict the number of elements
        // with the input type at compile time.
        if (replaceOptionWithVector) {
          endFlattenedTypeTag = flattenedTypeTag.map((tag) => {
            if (tag.isStruct() && tag.isOption()) {
              // Options must always have only 1 type, so we can just pop the first generic typeArg off
              // and reconstructor a TypeTagVector with it
              return new TypeTagVector(tag.value.typeArgs[0]);
            }
            return tag;
          });
        } else {
          // the only time we have a GenericType at the end is when it's for the actual argument.
          // since we pop the argument off if it's an Object<T>, we can assume that it's an actual
          // generic argument that the developer will have to serialize themselves.

          console.log("is a generic type tag ?" + endFlattenedTypeTag[flattenedTypeTag.length - 1].isGeneric());
        }
        functionArguments.push({
          typeTagArray: endFlattenedTypeTag,
          classString: toClassesString(endFlattenedTypeTag),
          annotation,
        });
      }
    });

    return {
      signerArguments,
      functionArguments,
      genericsWithAbilities,
    };
  }

  async fetchABIs(aptos: Aptos, accountAddress: AccountAddress): Promise<ABIGeneratedCodeMap> {
    const moduleABIs = await fetchModuleABIs(aptos, accountAddress);
    const sourceCodeMap = await getSourceCodeMap(accountAddress, aptos.config.network);

    let abiFunctions: AbiFunctions[] = [];
    let generatedCode: ABIGeneratedCodeMap = {};

    await Promise.all(
      moduleABIs.filter(isAbiDefined).map(async (module) => {
        const { abi } = module;
        const exposedFunctions = abi.exposed_functions;
        const sourceCode = sourceCodeMap[abi.name];

        const publicEntryFunctions = exposedFunctions.filter((func) => func.is_entry && func.visibility !== "private");
        const privateEntryFunctions = exposedFunctions.filter((func) => func.is_entry && func.visibility === "private");
        const viewFunctions = exposedFunctions.filter((func) => func.is_view);

        const publicMapping = getArgNameMapping(abi, publicEntryFunctions, sourceCode);
        const privateMapping = getArgNameMapping(abi, privateEntryFunctions, sourceCode);
        const viewMapping = getArgNameMapping(abi, viewFunctions, sourceCode);

        const abiFunction = {
          moduleAddress: AccountAddress.fromRelaxed(abi.address),
          moduleName: abi.name,
          publicEntryFunctions: getMoveFunctionsWithArgumentNames(abi, publicEntryFunctions, publicMapping),
          privateEntryFunctions: getMoveFunctionsWithArgumentNames(abi, privateEntryFunctions, privateMapping),
          viewFunctions: getMoveFunctionsWithArgumentNames(abi, viewFunctions, viewMapping),
        };

        // TODO: fix private functions printing twice?

        abiFunctions.push(abiFunction);
        const moduleName = toPascalCase(abiFunction.moduleName);

        // count the number of typeTags in the ABI
        // then populate the typeTags array with the correct number of generic type tags
        // and hard code them 1 by 1 into the generated code
        // you can also use this to count/match generics to a type `T` in Object<T>

        const functionsWithAnyVisibility = [
          abiFunction.publicEntryFunctions,
          abiFunction.privateEntryFunctions,
          abiFunction.viewFunctions,
        ];

        const codeForFunctionsWithAnyVisibility: Array<Array<string | undefined>> = [[], [], []];
        functionsWithAnyVisibility.forEach((functions, i) => {
          if (functions.length > 0) {
            codeForFunctionsWithAnyVisibility[i].push(
              ...functions.map((func) => {
                try {
                  const typeTags = func.params.map((param) => parseTypeTag(param, { allowGenerics: true }));
                  const generatedClassesCode = this.metaclassBuilder({
                    moduleAddress: abiFunction.moduleAddress,
                    moduleName: abiFunction.moduleName,
                    functionName: func.name,
                    className: `${toPascalCase(func.name)}`,
                    typeTags: typeTags,
                    genericTypeTags: func.genericTypes,
                    viewFunction: func.is_view,
                    displaySignerArgsAsComments: true,
                    suppliedFieldNames: func.argNames,
                    visibility: func.visibility as "public" | "private",
                    genericTypeParams: func.generic_type_params,
                    documentation: {
                      fullStructNames: false,
                      displayFunctionSignature: true,
                    },
                  });
                  return generatedClassesCode;
                } catch (e) {
                  if (func.params.find((param) => param.startsWith("&0x"))) {
                    console.warn(
                      `Ignoring deprecated parameter ${func.params.find((param) =>
                        param.startsWith("&0x"),
                      )} in function ${func.name}`,
                    );
                  } else {
                    const typeTags = func.params.map((param) => parseTypeTag(param, { allowGenerics: true }));
                    // console.log(func.genericTypes);
                    // console.log(typeTags.map((typeTag) => typeTag.toString()));
                    // console.log(abiFunction.moduleAddress.toString());
                    // console.log(abiFunction.moduleName);
                    // console.log(func.name);
                    console.error(e);
                  }
                }
              }),
            );
          }
        });

        const numPublicFunctions = abiFunction.publicEntryFunctions.length;
        const numPrivateFunctions = abiFunction.privateEntryFunctions.length;
        const numViewFunctions = abiFunction.viewFunctions.length;

        const publicFunctionsCodeString = `\n${codeForFunctionsWithAnyVisibility[0].join("\n")}`;
        const privateFunctionsCodeString = `\n${codeForFunctionsWithAnyVisibility[1].join("\n")}\n`;
        const viewFunctionsCodeString = `\n${codeForFunctionsWithAnyVisibility[2].join("\n")}\n`;

        let entryFunctionsCode = `\n${publicFunctionsCodeString}${privateFunctionsCodeString}`;
        let viewFunctionsCode = `\n${viewFunctionsCodeString}`;
        if (this.config.separateViewAndEntryFunctionsByNamespace) {
          entryFunctionsCode = `export namespace ${this.config.entryFunctionsNamespace} { ${entryFunctionsCode} }`;
          viewFunctionsCode = `export namespace ${this.config.viewFunctionsNamespace} { ${viewFunctionsCode} }`;
        }

        if (numPublicFunctions + numPrivateFunctions + numViewFunctions > 0) {
          let code = "";
          code += numPublicFunctions + numPrivateFunctions > 0 ? entryFunctionsCode : "";
          code += numViewFunctions > 0 ? viewFunctionsCode : "";
          generatedCode[abi.name] = {
            address: abi.address,
            name: abi.name,
            code: code,
          };
        }
      }),
    );

    return generatedCode;
  }

  async generateCodeForModules(aptos: Aptos, moduleAddresses: Array<AccountAddress>): Promise<void> {
    const baseDirectory = this.config.outputPath ?? ".";
    if (!fs.existsSync(baseDirectory)) {
      fs.mkdirSync(baseDirectory);
    }
    const generatedIndexFile: Array<string> = [BOILERPLATE_COPYRIGHT];
    await Promise.all(
      moduleAddresses.map(async (address) => {
        const generatedCode = await this.fetchABIs(aptos, address);
        const namedAddresses = this.config.namedAddresses ?? {};
        const addressString = address.toString();
        const namedAddress = addressString in namedAddresses ? namedAddresses[addressString] : addressString;
        this.writeGeneratedCodeToFiles(namedAddress, baseDirectory, generatedCode);
        const fileNamedAddress = namedAddress.startsWith("0x")
          ? truncateAddressForFileName(address)
          : toPascalCase(namedAddress);
        const filePath = `${baseDirectory}/index.ts`;
        // Read from `index.ts` and check if the namedAddress is already in the file
        // If it is, don't add it again
        const newExport = `export * as ${fileNamedAddress} from "./${namedAddress}/index.js";\n`;
        generatedIndexFile.push(newExport);
        if (fs.existsSync(filePath)) {
          const fileContents = fs.readFileSync(filePath, "utf8");
          if (fileContents.includes(newExport)) {
            // pass
          } else {
            const newFileContents = fileContents + newExport;
            fs.writeFileSync(filePath, newFileContents);
          }
        } else {
          fs.writeFileSync(filePath, generatedIndexFile.join("\n"));
        }
      }),
    );
    copyCode(
      `./src/${FOR_GENERATION_DIRECTORY}/${PAYLOAD_BUILDERS_FILE_NAME}.ts`,
      baseDirectory + `${PAYLOAD_BUILDERS_FILE_NAME}.ts`,
      this.config.sdkPath,
    );
    copyCode(
      `./src/${FOR_GENERATION_DIRECTORY}/${ABI_TYPES_FILE_NAME}.ts`,
      baseDirectory + `${ABI_TYPES_FILE_NAME}.ts`,
      this.config.sdkPath,
    );
  }

  writeGeneratedCodeToFiles(
    namedAddress: string,
    baseDirectory: string,
    codeMap: ABIGeneratedCodeMap,
    skipEmptyModules = true,
  ) {
    const perAddressIndexFile: Array<string> = [BOILERPLATE_COPYRIGHT, IMPORT_ACCOUNT_ADDRESS];

    Object.keys(codeMap).forEach(async (moduleName, i) => {
      if (skipEmptyModules && (!codeMap[moduleName] || codeMap[moduleName].code.length === 0)) {
        console.debug(`Skipping empty module ${module}`);
        return;
      }

      const { address, name, code } = codeMap[moduleName];
      const directory = baseDirectory + "/" + namedAddress;
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
      }
      const fileName = `${name}.ts`;
      const filePath = `${directory}/${fileName}`;
      const contents = getBoilerplateImports(this.config.sdkPath) + "\n\n" + code;
      const prettifiedCode = await format(contents, { parser: "typescript" });

      perAddressIndexFile.push(`export * as ${toPascalCase(name)} from "./${name}.js";`);
      if (i === Object.keys(codeMap).length - 1) {
        perAddressIndexFile.push(`\nexport const ${MODULE_ADDRESS_FIELD_NAME} = AccountAddress.fromRelaxed("${address}");\n`);
        // create the index.ts file
        const indexFilePath = `${directory}/index.ts`;
        if (fs.existsSync(indexFilePath)) {
          fs.rmSync(indexFilePath);
        }
        fs.writeFileSync(indexFilePath, perAddressIndexFile.join("\n"));
      }

      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
      }
      fs.writeFileSync(filePath, prettifiedCode);
    });
  }

  // TODO: Add `deserializeAsTypeTag(typeTag: TypeTag)` where it deserializes something based solely on
  // a string type tag
  //
  // This would mean we have to include a `kind` in each BCS class instance that we can use as a string
  // type tag.
}
