// Copyright © Aptos Foundation
// SPDX-License-Identifier: Apache-2.0

import { TypeTag, TypeTagVector, TypeTagAddress } from "@aptos-labs/ts-sdk";
import { numberToLetter, toTypeTagEnum, TypeTagEnum, toClassString } from "../index.js";
import { R_PARENTHESIS } from "../index.js";

export function toInputTypeString(typeTags: Array<TypeTag>, forView: boolean): string {
  const mapping = forView ? inputTypeMapForView : inputTypeMapForEntry;
  const typeTag = typeTags[0];
  const typeTagEnum = toTypeTagEnum(typeTag);
  switch (typeTagEnum) {
    case TypeTagEnum.Vector:
      if (typeTags.length === 2 && typeTags[1].isU8()) {
        return "HexInput";
      }
    case TypeTagEnum.Option:
      return `${mapping[typeTagEnum]}<${toInputTypeString(typeTags.slice(1), forView)}>`;
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
    case TypeTagEnum.Signer:
      return mapping[typeTagEnum];
    default:
      throw new Error(`Unexpected TypeTagEnum: ${typeTagEnum}`);
  }
}

/**
 * The transformer function for converting the constructor input types to the class field types
 * @param typeTags the array of typeTags, aka the class types as strings
 * @returns a string representing the generated typescript code to convert the constructor input type to the class field type
 * @see BCSKinds
 */
export function transformEntryFunctionInputTypes(
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
      let newTypeTag = typeTag;
      let newTypeTagEnum = toTypeTagEnum(typeTag);
      if (typeTag.isStruct() && typeTag.isOption()) {
        newTypeTag = replaceOptionWithVector ? new TypeTagVector(typeTag.value.typeArgs[0]) : typeTag;
        newTypeTagEnum = toTypeTagEnum(newTypeTag);
      }
      const innerNameFromDepth = `arg${numberToLetter(depth + 1)}`;
      return (
        `new ${toClassString(newTypeTagEnum)}(${nameFromDepth}.map(${innerNameFromDepth} => ` +
        `${transformEntryFunctionInputTypes(innerNameFromDepth, typeTags.slice(1), depth + 1)})`
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

/**
 * The transformer function for converting the constructor input types to the view function JSON types.
 */
export function transformViewFunctionInputTypes(fieldName: string, typeTags: Array<TypeTag>, depth: number): string {
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
        `${transformViewFunctionInputTypes(innerNameFromDepth, typeTags.slice(1), depth + 1)}`
      );
    }
    case TypeTagEnum.AccountAddress:
      return `${toClassString(toTypeTagEnum(typeTag))}.fromRelaxed(${nameFromDepth}).toString()${R_PARENTHESIS.repeat(depth)}`;
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

export const inputTypeMapForView: { [key in TypeTagEnum]: string } = {
  Bool: "boolean",
  U8: "Uint8",
  U16: "Uint16",
  U32: "Uint32",
  U64: "string",
  U128: "string",
  U256: "string",
  AccountAddress: "string",
  String: "string",
  Vector: "Array",
  Option: "Option", // OneOrNone<T>
  Object: "ObjectAddress",
  Signer: "Signer",
  Generic: "InputTypes",
  Struct: "Struct",
};

export const inputTypeMapForEntry: { [key in TypeTagEnum]: string } = {
  Bool: "boolean",
  U8: "Uint8",
  U16: "Uint16",
  U32: "Uint32",
  U64: "Uint64",
  U128: "Uint128",
  U256: "Uint256",
  AccountAddress: "AccountAddressInput",
  String: "string",
  Vector: "Array",
  Option: "Option", // OneOrNone<T>
  Object: "ObjectAddress",
  Signer: "Signer",
  Generic: "InputTypes",
  Struct: "Struct",
};
