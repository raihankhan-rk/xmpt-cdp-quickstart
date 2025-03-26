import { z } from "zod";

/**
 * Action schemas for the example action provider.
 *
 * This file contains the Zod schemas that define the shape and validation
 * rules for action parameters in the example action provider.
 */

/**
 * Example action schema demonstrating various field types and validations.
 * Replace or modify this with your actual action schemas.
 */
export const CdpActionSchema = z.object({
  /**
   * A descriptive name for the field
   */
  fieldName: z.string().min(1).max(100),

  /**
   * The amount to use in the action (as a decimal string, e.g. '0.01')
   */
  amount: z.string().regex(/^\d*\.?\d+$/, "Amount must be a valid decimal number"),

  /**
   * Optional parameter example
   */
  optionalField: z.string().optional(),
});
