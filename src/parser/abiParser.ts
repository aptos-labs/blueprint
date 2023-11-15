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
  numberToLetter,
  toFlattenedTypeTag,
  toPascalCase,
  truncateAddressForFileName,
  truncatedTypeTagString,
  copyCode,
  toTypeTagEnum,
  TypeTagEnum,
  toClassString,
  inputTypeMapForEntry,
  inputTypeMapForView,
  toClassesString,
} from "../index.js";
import fs from "fs";
import { ConfigDictionary } from "./config.js";
import { format } from "prettier";
import {
  DEFAULT_ARGUMENT_BASE,
  R_PARENTHESIS,
  FOR_GENERATION_DIRECTORY,
  PAYLOAD_BUILDERS_FILE_NAME,
  ABI_TYPES_FILE_NAME,
  getBoilerplateImports,
  BOILERPLATE_COPYRIGHT,
} from "../index.js";

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
    const GENERIC_TYPE_TAGS = new Array<TypeTag>();
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
          const viewFunctionInputTypeConverter = this.toInputTypeString(functionArgument.typeTagArray, viewFunction);
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

    // ---------- Class fields ---------- //
    const entryOrView = viewFunction ? "View" : "Entry";
    lines.push(`export class ${className} extends ${entryOrView}FunctionPayloadBuilder {`);
    lines.push(`public readonly moduleAddress = AccountAddress.fromRelaxed("${moduleAddress.toString()}");`);
    lines.push(`public readonly moduleName = "${moduleName}";`);
    lines.push(`public readonly functionName = "${functionName}";`);
    if (functionArguments.length > 0) {
      lines.push(`public readonly args: ${argsType};`);
    } else {
      lines.push(`public readonly args = { };`);
    }
    lines.push(
      `public readonly typeTags: Array<TypeTag> = []; ${atleastOneGeneric ? "//" : ""} ${joinedGenericsWithAbilities}`,
    );
    lines.push("");

    // -------- Constructor input types -------- //
    // constructor fields
    if (functionArguments.length > 0) {
      lines.push(`private constructor(`);
      signerArguments.forEach((signerArgument, i) => {
        if (this.config.includeAccountParams) {
          lines.push(`${signerArgumentNames[i]}: Account, // ${signerArgument.annotation}`);
        } else if (displaySignerArgsAsComments) {
          lines.push(`// ${signerArgumentNames[i]}: ${signerArgument.annotation},`);
        }
      });
      functionArguments.forEach((functionArgument, i) => {
        const inputType = this.toInputTypeString(functionArgument.typeTagArray, viewFunction);
        const argComment = ` // ${functionArgument.annotation}`;
        lines.push(`${fieldNames[i]}: ${inputType}, ${argComment}`);
      });
      if (genericTypeTags) {
        lines.push(`typeTags: Array<TypeTagInput>, ${atleastOneGeneric ? "//" : ""} ${joinedGenericsWithAbilities}`);
      }
      if (this.config.includeAccountParams && !viewFunction) {
        lines.push("feePayer?: Account, // optional fee payer account to sponsor the transaction");
      }
      lines.push(`) {`);

      // -------- Assign constructor fields to class fields -------- //
      lines.push(`super();`);
      lines.push(`this.args = {`);
      functionArguments.forEach((_, i) => {
        // Don't use BCS classes for view functions, since they don't need to be serialized
        // Although we can use them eventually when view functions accepts BCS inputs
        if (viewFunction) {
          // lines.push(`${fieldNames[i]}: ${functionArguments[i].kindArray},`);
          const viewFunctionInputTypeConverter = this.transformViewFunctionInputTypes(
            fieldNames[i],
            functionArguments[i].typeTagArray,
            0,
          );
          lines.push(`${fieldNames[i]}: ${viewFunctionInputTypeConverter},`);
        } else {
          const entryFunctionInputTypeConverter = this.transformEntryFunctionInputTypes(
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
      lines.push(`}`);
    } else {
      lines.push(`constructor() { super(); this.args = { }; }`);
    }
    lines.push("");
    lines.push("}");
    return lines.join("\n");
  }

  toInputTypeString(typeTags: Array<TypeTag>, forView: boolean): string {
    const mapping = forView ? inputTypeMapForView : inputTypeMapForEntry;
    const typeTag = typeTags[0];
    const typeTagEnum = toTypeTagEnum(typeTag);
    switch (typeTagEnum) {
      case TypeTagEnum.Vector:
        if (typeTags.length === 2 && typeTags[1].isU8()) {
          return "HexInput";
        }
      case TypeTagEnum.Option:
        return `${mapping[typeTagEnum]}<${this.toInputTypeString(typeTags.slice(1), forView)}>`;
      case TypeTagEnum.Bool:
      case TypeTagEnum.U8:
      case TypeTagEnum.U16:
      case TypeTagEnum.U32:
      case TypeTagEnum.String:
      case TypeTagEnum.Object:
      case TypeTagEnum.U64:
      case TypeTagEnum.U128:
      case TypeTagEnum.U256:
      case TypeTagEnum.AccountAddress:
      case TypeTagEnum.Generic:
        return mapping[typeTagEnum];
      default:
        throw new Error(`Unexpected TypeTagEnum: ${typeTagEnum}`);
    }
  }

  /**
   * The transformer function for converting the constructor input types to the view function JSON types.
   *
   */
  transformViewFunctionInputTypes(fieldName: string, typeTags: Array<TypeTag>, depth: number): string {
    // replace MoveObject with AccountAddress for the constructor input types
    const typeTag = typeTags[0].isStruct() && typeTags[0].isObject() ? new TypeTagAddress() : typeTags[0];
    const nameFromDepth = depth === 0 ? `${fieldName}` : `arg${numberToLetter(depth)}`;
    const typeTagEnum = toTypeTagEnum(typeTag);
    switch (typeTagEnum) {
      case TypeTagEnum.Vector:
        // if we're at the innermost type and it's a vector<u8>, we'll use the MoveVector.U8(hex: HexInput) factory method
        if (typeTags.length === 2 && typeTags[1].isU8()) {
          return `Hex.fromHexInput(${nameFromDepth})${R_PARENTHESIS.repeat(depth)}.toString()`;
        }
      case TypeTagEnum.Option: {
        const innerNameFromDepth = `arg${numberToLetter(depth + 1)}`;
        return (
          `${nameFromDepth}.map(${innerNameFromDepth} => ` +
          `${this.transformViewFunctionInputTypes(innerNameFromDepth, typeTags.slice(1), depth + 1)}`
        );
      }
      case TypeTagEnum.AccountAddress:
        return `${typeTag}.fromRelaxed(${nameFromDepth}).toString()${R_PARENTHESIS.repeat(depth)}`;
      case TypeTagEnum.Bool:
      case TypeTagEnum.U8:
      case TypeTagEnum.U16:
      case TypeTagEnum.U32:
      case TypeTagEnum.String:
        return `${nameFromDepth}${R_PARENTHESIS.repeat(depth)}`;
      case TypeTagEnum.U64:
      case TypeTagEnum.U128:
      case TypeTagEnum.U256:
        return `BigInt(${nameFromDepth}).toString()${R_PARENTHESIS.repeat(depth)}`;
      case TypeTagEnum.Generic:
        return inputTypeMapForView[typeTagEnum];
      default:
        throw new Error(`Unknown typeTag: ${typeTag}`);
    }
  }

  /**
   * The transformer function for converting the constructor input types to the class field types
   * @param typeTags the array of BCSKinds, aka the class types as strings
   * @returns a string representing the generated typescript code to convert the constructor input type to the class field type
   * @see BCSKinds
   */
  transformEntryFunctionInputTypes(
    fieldName: string,
    typeTags: Array<TypeTag>,
    depth: number,
    replaceOptionWithVector = true,
  ): string {
    // replace MoveObject with AccountAddress for the constructor input types
    const typeTag = typeTags[0].isStruct() && typeTags[0].isObject() ? new TypeTagAddress() : typeTags[0];
    const nameFromDepth = depth === 0 ? `${fieldName}` : `arg${numberToLetter(depth)}`;
    const typeTagEnum = toTypeTagEnum(typeTag);
    switch (typeTagEnum) {
      case TypeTagEnum.Vector:
        // if we're at the innermost type and it's a vector<u8>, we'll use the MoveVector.U8(hex: HexInput) factory method
        if (typeTags.length === 2 && typeTags[1].isU8()) {
          return `MoveVector.U8(${nameFromDepth})${R_PARENTHESIS.repeat(depth)}`;
        }
      case TypeTagEnum.Option: {
        // conditionally replace MoveOption with MoveVector for the constructor input types
        const newTypeTag = replaceOptionWithVector ? new TypeTagVector((typeTag as any).value.typeArgs[0]) : typeTag;
        const newTypeTagEnum = toTypeTagEnum(newTypeTag);
        const innerNameFromDepth = `arg${numberToLetter(depth + 1)}`;
        return (
          `new ${toClassString(newTypeTagEnum)}(${nameFromDepth}.map(${innerNameFromDepth} => ` +
          `${this.transformEntryFunctionInputTypes(innerNameFromDepth, typeTags.slice(1), depth + 1)})`
        );
      }
      case TypeTagEnum.AccountAddress:
        return `${toClassString(typeTagEnum)}.fromRelaxed(${nameFromDepth})${R_PARENTHESIS.repeat(depth)}`;
      case TypeTagEnum.Bool:
      case TypeTagEnum.U8:
      case TypeTagEnum.U16:
      case TypeTagEnum.U32:
      case TypeTagEnum.U64:
      case TypeTagEnum.U128:
      case TypeTagEnum.U256:
      case TypeTagEnum.String:
        return `new ${toClassString(typeTagEnum)}(${nameFromDepth})${R_PARENTHESIS.repeat(depth)}`;
      case TypeTagEnum.Generic:
        return fieldName;
      default:
        throw new Error(`Unknown typeTag: ${typeTag}`);
    }
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
      if (flattenedTypeTag[0].isSigner()) {
        signerArguments.push({
          typeTagArray: [flattenedTypeTag[0]],
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

  // TODO: Add support for view functions. It should be very straightforward, since they're
  // the same as entry functions but with no BCS serialization, so it just uses the input types.
  // Also, no signers (verify this?)
  //
  // TODO: Add support for remote ABI BCS serialization? You just would treat everything like a view function.
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
        if (moduleName === "tournament_manager") {
          console.log(abiFunction.publicEntryFunctions);
          console.log(abiFunction.privateEntryFunctions);
        }
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

        // const namespaceString = `export namespace ${moduleName} {\n`;

        let entryFunctionsCode = `\n${publicFunctionsCodeString}${privateFunctionsCodeString}`;
        let viewFunctionsCode = `\n${viewFunctionsCodeString}`;
        if (this.config.separateViewAndEntryFunctionsByNamespace) {
          entryFunctionsCode = `export namespace ${this.config.entryFunctionsNamespace} { ${entryFunctionsCode} }`;
          viewFunctionsCode = `export namespace ${this.config.viewFunctionsNamespace} { ${viewFunctionsCode} }`;
        }

        if (numPublicFunctions + numPrivateFunctions + numViewFunctions > 0) {
          // let code = `${namespaceString}`;
          let code = "";
          code += numPublicFunctions + numPrivateFunctions > 0 ? entryFunctionsCode : "";
          code += numViewFunctions > 0 ? viewFunctionsCode : "";
          // code += `}`;
          generatedCode[abi.name] = {
            address: abi.address,
            name: abi.name,
            code: await format(code, { parser: "typescript" }),
            // code: code,
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
        generatedIndexFile.push(`export * as ${fileNamedAddress} from "./${namedAddress}";`);
        generatedIndexFile.push("\n");
        const filePath = `${baseDirectory}/index.ts`;
        // Read from `index.ts` and check if the namedAddress is already in the file
        // If it is, don't add it again
        const newExport = `export * as ${fileNamedAddress} from "./${namedAddress}";\n`;
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
      `./src/abi/${FOR_GENERATION_DIRECTORY}/${PAYLOAD_BUILDERS_FILE_NAME}.ts`,
      baseDirectory + `${PAYLOAD_BUILDERS_FILE_NAME}.ts`,
      this.config.sdkPath,
    );
    copyCode(
      `./src/abi/${FOR_GENERATION_DIRECTORY}/${ABI_TYPES_FILE_NAME}.ts`,
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
    const perAddressIndexFile: Array<string> = [BOILERPLATE_COPYRIGHT];

    Object.keys(codeMap).forEach(async (moduleName, i) => {
      if (skipEmptyModules && (!codeMap[moduleName] || codeMap[moduleName].code.length === 0)) {
        console.debug(`Skipping empty module ${module}`);
        return;
      }

      const { name, code } = codeMap[moduleName];
      const directory = baseDirectory + "/" + namedAddress;
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
      }
      const fileName = `${name}.ts`;
      const filePath = `${directory}/${fileName}`;
      const contents = getBoilerplateImports(this.config.sdkPath) + "\n\n" + code;

      perAddressIndexFile.push(`export * as ${toPascalCase(name)} from "./${name}";`);
      if (i === Object.keys(codeMap).length - 1) {
        perAddressIndexFile.push("\n");
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
      fs.writeFileSync(filePath, contents);
    });
  }

  // TODO: Add `deserializeAsTypeTag(typeTag: TypeTag)` where it deserializes something based solely on
  // a string type tag
  //
  // This would mean we have to include a `kind` in each BCS class instance that we can use as a string
  // type tag.
}
