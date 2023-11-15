// Copyright © Aptos Foundation
// SPDX-License-Identifier: Apache-2.0

import { TypeTag, TypeTagReference, TypeTagSigner } from "@aptos-labs/ts-sdk";
import { TypeTagEnum } from "../types.js";

export function isReference(typeTag: TypeTag): typeTag is TypeTagReference {
  return typeTag instanceof TypeTagReference;
}

export function isSignerReference(typeTag: TypeTag): boolean {
  if (!isReference(typeTag)) {
    return false;
  }
  return typeTag.value.isSigner();
}

export function truncatedTypeTagString(args: {
  typeTag: TypeTag;
  namedAddresses?: Record<string, string>;
  namedTypeTags?: Record<string, string>;
}): string {
  const { typeTag } = args;
  const namedAddresses = args.namedAddresses ?? {};
  const namedTypeTags = args.namedTypeTags ?? {};

  if (typeTag.isVector()) {
    return `vector<${truncatedTypeTagString({ typeTag: typeTag.value, namedAddresses, namedTypeTags })}>`;
  }
  if (typeTag.isStruct()) {
    if (typeTag.isOption()) {
      return `Option<${typeTag.value.typeArgs
        .map((typeTag) => truncatedTypeTagString({ typeTag, namedAddresses, namedTypeTags }))
        .join(", ")}>`;
    }
    if (typeTag.isObject()) {
      return `Object<${typeTag.value.typeArgs
        .map((typeTag) => truncatedTypeTagString({ typeTag, namedAddresses, namedTypeTags }))
        .join(", ")}>`;
    }
    if (typeTag.isString()) {
      return `String`;
    }
    // TODO: also replace named addresses?
    if (typeTag.toString() in namedTypeTags) {
      return namedTypeTags[typeTag.toString()];
    }
    if (typeTag.value.address.toString() in namedAddresses) {
      return `${namedAddresses[typeTag.value.address.toString()]}::${typeTag.value.moduleName.identifier}::${
        typeTag.value.name.identifier
      }`;
    }
  }
  return typeTag.toString();
}

// This function flattens an entry function argument TypeTag into an array of TypeTags, with the first being the outermost TypeTag
// that is potentially a TypeTagStruct with an inner .value that is a TypeTag
export function toFlattenedTypeTag(typeTag: TypeTag): Array<TypeTag> {
  if (typeTag.isVector()) {
    return [typeTag, ...toFlattenedTypeTag(typeTag.value)];
  }
  if (typeTag.isStruct()) {
    if (typeTag.isString()) {
      return [typeTag];
    }
    if (typeTag.isObject() || typeTag.isOption()) {
      // Objects and Options can only have 1 TypeTag
      return [typeTag, ...toFlattenedTypeTag(typeTag.value.typeArgs[0])];
    }
    // It must be a resource, otherwise the .move file would not compile
    return [typeTag];
  }
  if (isReference(typeTag)) {
    if (typeTag.value.isSigner()) {
      return [typeTag];
    }
    throw new Error(`Invalid reference argument: ${typeTag.toString()}`);
  }
  if (typeTag.isSigner()) {
    return [typeTag];
  }
  // everything else is a primitive
  return [typeTag];
}

export function toTypeTagEnum(typeTag: TypeTag): TypeTagEnum {
  if (typeTag.isVector()) {
    return TypeTagEnum.Vector;
  }
  if (typeTag.isStruct()) {
    if (typeTag.isString()) {
      return TypeTagEnum.String;
    }
    if (typeTag.isObject()) {
      return TypeTagEnum.Object;
    }
    if (typeTag.isOption()) {
      return TypeTagEnum.Option;
    }
    // It must be a resource, otherwise the .move file would not compile
    return TypeTagEnum.Struct;
  }
  if (typeTag.isGeneric()) {
    return TypeTagEnum.Generic;
  }
  switch (typeTag.toString()) {
    case "bool":
      return TypeTagEnum.Bool;
    case "u8":
      return TypeTagEnum.U8;
    case "u16":
      return TypeTagEnum.U16;
    case "u32":
      return TypeTagEnum.U32;
    case "u64":
      return TypeTagEnum.U64;
    case "u128":
      return TypeTagEnum.U128;
    case "u256":
      return TypeTagEnum.U256;
    case "address":
      return TypeTagEnum.AccountAddress;
    case "&signer":
    case "signer":
      return TypeTagEnum.Signer;
    default:
      // if it's still a reference, it's an invalid one, because we already checked for signer
      if (isReference(typeTag)) {
        throw new Error(`Invalid reference argument: ${typeTag.toString()}`);
      }
      throw new Error(`Unknown TypeTag: ${typeTag}`);
  }
}

export function toClassString(typeTagEnum: TypeTagEnum): string {
  switch (typeTagEnum) {
    case TypeTagEnum.Bool:
      return "Bool";
    case TypeTagEnum.U8:
      return "U8";
    case TypeTagEnum.U16:
      return "U16";
    case TypeTagEnum.U32:
      return "U32";
    case TypeTagEnum.U64:
      return "U64";
    case TypeTagEnum.U128:
      return "U128";
    case TypeTagEnum.U256:
      return "U256";
    case TypeTagEnum.AccountAddress:
      return "AccountAddress";
    case TypeTagEnum.String:
      return "MoveString";
    case TypeTagEnum.Vector:
      return "MoveVector";
    case TypeTagEnum.Option:
      return "MoveOption";
    case TypeTagEnum.Object:
      return "MoveObject";
    case TypeTagEnum.Signer:
      return "Signer";
    case TypeTagEnum.Generic:
      return "EntryFunctionArgumentTypes";
    case TypeTagEnum.Struct:
      throw new Error(`Cannot convert ${typeTagEnum} to BCS class string`);
    default:
      throw new Error(`Unknown TypeTagEnum: ${typeTagEnum}`);
  }
}
