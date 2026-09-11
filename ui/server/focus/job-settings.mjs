// Setup owns defaults; subsequent phases consume the stored choice.
export function setupSettings(value={helpMode:'ongoing',scope:''},input={}) {
  if(!value || Object.keys(value).sort().join(',')!=='helpMode,scope' || !['ongoing','one_time'].includes(value.helpMode) || typeof value.scope!=='string' || value.scope.length>4000)
    throw new Error('The AI returned invalid job settings. Try setup again.');
  const supplied=[input.problem,input.tried].filter(text=>typeof text==='string');
  if((value.helpMode==='one_time' && !value.scope.trim()) || (value.scope && !supplied.some(text=>text.includes(value.scope))))
    throw new Error('The job scope must quote your supplied request. Try setup again.');
  return {helpMode:value.helpMode,scope:value.scope};
}

export const setupSettingsSchema={type:'object',additionalProperties:false,required:['helpMode','scope'],properties:{helpMode:{type:'string',enum:['ongoing','one_time']},scope:{type:'string',maxLength:4000}}};
