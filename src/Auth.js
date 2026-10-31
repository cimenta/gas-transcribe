const Auth = {
  isOwner(activeEmail, effectiveEmail) {
    return Boolean(activeEmail) && Boolean(effectiveEmail) && activeEmail === effectiveEmail;
  },
};

function assertOwner_() {
  const active = Session.getActiveUser().getEmail();
  const effective = Session.getEffectiveUser().getEmail();
  if (!Auth.isOwner(active, effective)) {
    throw new Error('Forbidden');
  }
}

if (typeof module !== 'undefined') module.exports = Auth;
