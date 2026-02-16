import { defaultTheme, extendTheme } from '@inkjs/ui';

export const tuinnelTheme = extendTheme(defaultTheme, {
  components: {
    Spinner: {
      styles: {
        frame: () => ({ color: 'cyan' }),
      },
    },
    Select: {
      styles: {
        focusIndicator: () => ({ color: 'cyan' }),
        label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => {
          let color;
          if (isSelected) color = 'green';
          if (isFocused) color = 'cyan';
          return { color };
        },
      },
    },
    Badge: {
      styles: {
        container: () => ({ backgroundColor: 'cyan' }),
      },
    },
    ProgressBar: {
      styles: {
        completed: () => ({ color: 'cyan' }),
      },
    },
  },
});
