function doGet() {
  assertOwner_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('GAS Transcribe')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
