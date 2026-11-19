// String.prototype.localeCompare parity: ICU collation in the machine's default
// locale, the same runtime choice Node makes. Byte order diverges for CJK names,
// accents and case, so every JS localeCompare sort goes through here.
use icu_collator::{options::CollatorOptions, CollatorBorrowed, CollatorPreferences};
use std::cmp::Ordering;

thread_local! {
    static COLLATOR: CollatorBorrowed<'static> = build();
}

fn build() -> CollatorBorrowed<'static> {
    let tag = sys_locale::get_locale().unwrap_or_else(|| "en".to_string());
    let mut prefs = CollatorPreferences::default();
    if let Ok(locale) = tag.parse::<icu_locale::Locale>() {
        prefs.locale_preferences = (&locale).into();
    }
    CollatorBorrowed::try_new(prefs, CollatorOptions::default())
        .or_else(|_| CollatorBorrowed::try_new(CollatorPreferences::default(), CollatorOptions::default()))
        .expect("compiled collation data")
}

pub fn compare(a: &str, b: &str) -> Ordering {
    COLLATOR.with(|c| c.compare(a, b))
}