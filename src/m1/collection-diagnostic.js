'use strict';
// This projection never carries an exception object across the worker boundary.
const STAGES=new Set(['source-watch','source-stamp','source-refresh','source-scan','native-verification','custom-source','discovery','worker','collection','ingest','maintenance']);
const OS=new Set(['EACCES','EPERM','ENOENT','ENOSPC','EMFILE','ENFILE','EIO','EBUSY','EROFS','ENOTDIR','EISDIR','EINVAL','ETIMEDOUT']);
const NATIVE=new Set(['NATIVE_UNAVAILABLE','NATIVE_BINARY_MISMATCH','NATIVE_TIMEOUT','NATIVE_OUTPUT_LIMIT','NATIVE_FAILED','NATIVE_SCHEMA_MISMATCH','NATIVE_TOTAL_MISMATCH']);
const CONTRACT=new Set(['CONTROLLED_ERROR','COLLECTION_TIMEOUT','COLLECTION_WORKER_FAILED']);
// Existing public error codes, not a pattern accepting arbitrary uppercase text.
const ERRORS=new Set([...OS,...NATIVE,
  'COLLECTION_FAILED','COLLECTION_TIMEOUT','COLLECTION_WORKER_FAILED','DISCOVERY_FAILED','DISCOVERY_TIMEOUT',
  'MAINTENANCE_BUSY','MAINTENANCE_INCOMPLETE','MAINTENANCE_STALE','LOCAL_STORAGE_INVALID',
  'SOURCE_PARSE_FAILED','SOURCE_UNREADABLE','SOURCE_LIMIT','SOURCE_TIMEOUT','SOURCE_BUSY','SOURCE_SIZE_OR_LINK',
  'SOURCE_PATH_REJECTED','SOURCE_SYMLINK_REJECTED','SOURCE_ALIAS_REJECTED','SOURCE_PRODUCT_OVERLAP',
  'CUSTOM_CONFIG_INVALID','CUSTOM_FIELD_INVALID','CUSTOM_COUNTER_UNSUPPORTED','CUSTOM_LINE_LIMIT','CUSTOM_INCOMPLETE_LINE','CUSTOM_ROOT_REQUIRED','CUSTOM_SOURCE_OVERLAP',
  'DATABASE_SCHEMA_UNSUPPORTED','CURSOR_CSV_INVALID','CURSOR_CSV_SCHEMA','SOURCE_COMPRESSION_UNSUPPORTED','SOURCE_COMPRESSION_INVALID',
  'INCOMPLETE_FRAME','INVALID_FRAME','DEEPSEEK_FORMAT_UNSUPPORTED','DEEPSEEK_SEED_INVALID']);
function code(error,fallback='COLLECTION_FAILED'){
  return ERRORS.has(error?.message)?error.message:fallback;
}
function classify(error,stage='collection'){
  stage=STAGES.has(stage)?stage:'collection';
  const reason=[error?.code,error?.cause?.code,error?.message].find(value=>OS.has(value));
  if(reason)return {stage,category:'os',reason};
  if(NATIVE.has(error?.message))return {stage,category:'native',reason:error.message};
  if(ERRORS.has(error?.message))return {stage,category:'contract',reason:CONTRACT.has(error.message)?error.message:'CONTROLLED_ERROR'};
  return {stage,category:'unknown',reason:'UNKNOWN'};
}
function sanitize(value){
  if(!value||!STAGES.has(value.stage))return null;
  const allowed=value.category==='os'?OS:value.category==='native'?NATIVE:value.category==='contract'?CONTRACT:value.category==='unknown'?new Set(['UNKNOWN']):null;
  return allowed?.has(value.reason)?{stage:value.stage,category:value.category,reason:value.reason}:null;
}
function failure(error,stage,fallback){return {error:code(error,fallback),diagnostic:classify(error,stage)};}
function fromMessage(message,fallback='COLLECTION_FAILED',stage='collection'){
  const error=new Error(code({message:message.error},fallback));
  error.diagnostic=sanitize(message.diagnostic)||classify(error,stage);
  return error;
}
module.exports={classify,sanitize,failure,fromMessage};
