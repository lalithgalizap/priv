import logging
import re
from typing import List, Tuple

logger = logging.getLogger("anonymizer")

# Try to import Presidio for NLP-based PII detection
try:
    from presidio_analyzer import AnalyzerEngine
    from presidio_anonymizer import AnonymizerEngine as PresidioAnonymizer
    from presidio_anonymizer.entities import OperatorConfig
    PRESIDIO_AVAILABLE = True
except ImportError:
    PRESIDIO_AVAILABLE = False
    logger.info("Presidio not available; falling back to regex-based PII detection")


class AnonymizerEngine:
    # Named rule registry: rule_id -> (regex_pattern, replacement)
    RULE_REGISTRY: dict[str, Tuple[re.Pattern, str]] = {
        "email": (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'), '[EMAIL_REDACTED]'),
        "ip": (re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b'), '[IP_REDACTED]'),
        "ssn": (re.compile(r'\b\d{3}-\d{2}-\d{4}\b'), '[SSN_REDACTED]'),
        "phone": (re.compile(r'\b\+?1?\s?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'), '[PHONE_REDACTED]'),
        "credit_card": (re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'), '[CARD_REDACTED]'),
        "name": (re.compile(r'\b[A-Z][a-z]+\s[A-Z][a-z]+\b'), '[NAME_REDACTED]'),  # basic heuristic
        "address": (re.compile(r'\b\d+\s+[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct)\b', re.IGNORECASE), '[ADDRESS_REDACTED]'),
        "url": (re.compile(r'https?://[^\s]+:[^\s]+@[^\s]+'), '[URL_WITH_CREDS_REDACTED]'),
    }

    def __init__(self):
        # Corporate identifier patterns (always active)
        self.corporate_patterns: List[Tuple[re.Pattern, str]] = [
            (re.compile(r'\b(?:internal|corp|enterprise)\.[a-z]+\.[a-z]+\b', re.IGNORECASE), '[CORP_DOMAIN_REDACTED]'),
        ]

        # NLP-based PII detection (optional)
        self._presidio_analyzer: Optional = None
        self._presidio_anonymizer: Optional = None
        if PRESIDIO_AVAILABLE:
            try:
                self._presidio_analyzer = AnalyzerEngine()
                self._presidio_anonymizer = PresidioAnonymizer()
            except Exception:
                pass  # spaCy model may not be installed

    def _presidio_sanitize(self, text: str) -> str:
        """Use Presidio NLP engine for advanced PII detection."""
        if self._presidio_analyzer is None or self._presidio_anonymizer is None:
            return text

        try:
            results = self._presidio_analyzer.analyze(text=text, language="en")
            if not results:
                return text

            operators = {}
            for result in results:
                entity = result.entity_type
                operators[entity] = OperatorConfig(
                    "replace",
                    {"new_value": f"[{entity.upper().replace('_', ' ')} REDACTED]"},
                )

            return self._presidio_anonymizer.anonymize(
                text=text, analyzer_results=results, operators=operators
            ).text
        except Exception as e:
            logger.warning("Presidio sanitization failed: %s; falling back to regex", e)
            return text

    def _regex_sanitize(self, text: str, enabled_rules: list[str] | None = None) -> str:
        """Use regex patterns for basic PII detection.

        If enabled_rules is provided, only apply rules whose IDs are in the list.
        Otherwise apply all registered rules (legacy behavior).
        """
        sanitized = text
        rules = self.RULE_REGISTRY
        if enabled_rules is not None:
            for rule_id in enabled_rules:
                if rule_id in rules:
                    pattern, replacement = rules[rule_id]
                    sanitized = pattern.sub(replacement, sanitized)
        else:
            for pattern, replacement in rules.values():
                sanitized = pattern.sub(replacement, sanitized)
        # Corporate patterns always apply
        for pattern, replacement in self.corporate_patterns:
            sanitized = pattern.sub(replacement, sanitized)
        return sanitized

    MAX_INPUT_LENGTH = 10000

    def sanitize_prompt(self, text: str, use_nlp: bool = True, enabled_rules: list[str] | None = None) -> str:
        """Sanitize prompt by redacting PII and corporate identifiers.

        If Presidio is available and use_nlp=True, uses NLP-based detection
        first, then applies regex patterns for anything missed.

        enabled_rules: list of rule IDs to apply (e.g., ["email", "phone"]).
                       If None, all registered rules are applied.
        """
        if not isinstance(text, str):
            raise TypeError("Prompt must be a string")
        if len(text) > self.MAX_INPUT_LENGTH:
            raise ValueError(f"Prompt exceeds maximum length of {self.MAX_INPUT_LENGTH} characters")

        sanitized = text

        # NLP-based detection if available
        if use_nlp and PRESIDIO_AVAILABLE and self._presidio_analyzer is not None:
            sanitized = self._presidio_sanitize(sanitized)

        # Apply regex patterns (filtered by enabled_rules if provided)
        sanitized = self._regex_sanitize(sanitized, enabled_rules=enabled_rules)

        return sanitized

    def add_corporate_pattern(self, regex: str, replacement: str) -> None:
        """Add a custom corporate identifier pattern."""
        self.corporate_patterns.append((re.compile(regex, re.IGNORECASE), replacement))


# Singleton instance
anonymizer_engine = AnonymizerEngine()
