// App-owned phase boundary. A plan or model argument cannot enable account work.
export const researchTools=['public.search','memory.search','document.save','document.read','tool.output','browser.open','browser.read','browser.view','browser.click','browser.login','browser.fill','browser.press','browser.select','browser.hover','browser.scroll'];
export function researchBlocked(){
 const error=new Error('This phase only gathers context. Account changes, messages, submissions and scheduled actions are not available. Continue researching with the read-only tools; do not ask for approval of this change.');
 error.code='RESEARCH_ONLY';return error;
}
export function researchNavigationBlocked(reason){
 const messages={
  target_unresolved:'The app could not identify the referenced control in the saved page. No action was sent. Refresh the page or inspect its image, then select a current reference for review. This is not a user decline or proof of an account-changing action.',
  review_unavailable:'The navigation review was unavailable. No action was sent. Use independent read-only research; a fresh review may be attempted when available. This is not a user decline.',
  review_invalid:'The navigation review returned an unreadable decision. No action was sent. Refresh the evidence before requesting a new review, and continue independent read-only research.',
  context_changed:'The job, page or Auto setting changed during navigation review. No action was sent. Inspect the current page and obtain a fresh review.',
  review_required:'The review could not confirm that this control only views information. No action was sent. Do not repeat this blocked action or assume it is safe. Continue independent research and other read-only routes; this does not block the whole research plan.',
 };
 const diagnostic=Object.hasOwn(messages,reason)?reason:'review_invalid';
 const error=new Error(messages[diagnostic]);error.code='RESEARCH_ONLY';error.diagnostic=diagnostic;
 if(diagnostic!=='review_required')error.actionState='not_performed';
 return error;
}
