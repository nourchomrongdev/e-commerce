export type PayPalCardField = { render(selector: string): Promise<unknown> | unknown };

export type PayPalCardFields = {
  isEligible(): boolean;
  NameField(options?: { placeholder?: string }): PayPalCardField;
  NumberField(options?: { placeholder?: string }): PayPalCardField;
  ExpiryField(options?: { placeholder?: string }): PayPalCardField;
  CVVField(options?: { placeholder?: string }): PayPalCardField;
  submit(): Promise<void>;
};

type PayPalCardFieldsStyle = {
  input: { "font-size": string; "font-family": string };
  ".invalid": { color: string };
};

type PayPalCardFieldsBaseOptions = {
  style?: PayPalCardFieldsStyle;
  onError(error: unknown): void;
};

export type PayPalCardFieldsOptions =
  | (PayPalCardFieldsBaseOptions & {
      style: PayPalCardFieldsStyle;
      createOrder(): Promise<string>;
      createVaultSetupToken?: never;
      onApprove(data: { orderID: string }): Promise<void> | void;
    })
  | (PayPalCardFieldsBaseOptions & {
      createOrder?: never;
      createVaultSetupToken(): Promise<string>;
      onApprove(data: { vaultSetupToken?: string; liabilityShift?: string }): Promise<void> | void;
    });

export type PayPalCardFieldsSdk = {
  CardFields(options: PayPalCardFieldsOptions): PayPalCardFields;
};
